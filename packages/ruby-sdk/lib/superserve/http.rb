require "faraday"
require "json"
require "time"

module Superserve
  # HTTP client wrapping Faraday with retry on idempotent methods,
  # exponential backoff with jitter, and SSE stream parsing.
  module HTTP
    DEFAULT_TIMEOUT = 30
    DEFAULT_STREAM_TIMEOUT = 300
    USER_AGENT = "superserve-ruby/#{Superserve::VERSION} (ruby/#{RUBY_VERSION})".freeze

    MAX_ATTEMPTS = 3
    BASE_BACKOFF = 0.1
    MAX_BACKOFF = 30.0
    RETRY_STATUS_CODES = [429, 502, 503, 504].freeze
    IDEMPOTENT_METHODS = [:get, :delete].freeze

    # Build a reusable Faraday connection. Pass a single connection per Sandbox
    # for connection pooling (analogous to httpx.Client in the Python SDK).
    def self.build_connection(timeout: DEFAULT_TIMEOUT)
      Faraday.new do |conn|
        conn.options.timeout = timeout
        conn.options.open_timeout = timeout
        conn.options.read_timeout = timeout
      end
    end

    # Make a JSON API request and return the parsed response body.
    # Returns nil for 204 No Content. Raises typed SandboxError on non-2xx.
    # Retries GET/DELETE on transient failures (429, 502/503/504, network errors).
    def self.api_request(method, url, headers:, json_body: nil, timeout: DEFAULT_TIMEOUT, connection: nil)
      conn = connection || build_connection(timeout: timeout)
      method_sym = method.to_sym
      body = json_body.nil? ? nil : JSON.generate(json_body)
      merged_headers = default_headers(headers, content_type: "application/json")

      response = do_request_with_retry(conn, method_sym, url, body, merged_headers, timeout)

      return nil if response.status == 204

      unless success?(response.status)
        raise Superserve.map_api_error(response.status, parse_error_body(response.body))
      end

      response.body.to_s.empty? ? nil : JSON.parse(response.body)
    end

    # Upload raw bytes (POST). Never retried — POST is not idempotent.
    def self.upload_bytes(url, headers:, content:, timeout: DEFAULT_TIMEOUT, connection: nil)
      conn = connection || build_connection(timeout: timeout)
      merged_headers = default_headers(headers, content_type: "application/octet-stream")

      begin
        response = conn.run_request(:post, url, content, merged_headers) do |req|
          req.options.timeout = timeout
          req.options.read_timeout = timeout
        end
      rescue Faraday::TimeoutError
        raise Superserve::TimeoutError.new("Upload timed out after #{timeout}s")
      rescue Faraday::ConnectionFailed => e
        raise Superserve::SandboxError.new("Upload error: #{e.message}")
      end

      unless success?(response.status)
        raise Superserve.map_api_error(response.status, parse_error_body(response.body))
      end

      nil
    end

    # Download raw bytes (GET). Retries on transient failures.
    def self.download_bytes(url, headers:, timeout: DEFAULT_TIMEOUT, connection: nil)
      conn = connection || build_connection(timeout: timeout)
      merged_headers = default_headers(headers)

      response = do_request_with_retry(conn, :get, url, nil, merged_headers, timeout)

      unless success?(response.status)
        raise Superserve.map_api_error(response.status, parse_error_body(response.body))
      end

      response.body.to_s
    end

    # Consume an SSE stream. Calls the block for each parsed event hash.
    # Idle timeout (Net::HTTP read_timeout) resets per chunk under the hood.
    # Supports POST (with body) and GET. Never retried — non-idempotent semantics.
    def self.stream_sse(url, headers:, json_body: nil, method: :post, timeout: DEFAULT_STREAM_TIMEOUT, connection: nil, &on_event)
      raise ArgumentError, "stream_sse requires a block" unless on_event

      conn = connection || build_connection(timeout: timeout)
      method_sym = method.to_sym
      body = json_body.nil? ? nil : JSON.generate(json_body)
      merged_headers = default_headers(
        headers,
        content_type: method_sym == :post ? "application/json" : nil
      )

      buffer = String.new

      begin
        response = conn.run_request(method_sym, url, body, merged_headers) do |req|
          req.options.timeout = timeout
          req.options.read_timeout = timeout
          req.options.on_data = proc do |chunk, _bytes|
            buffer << chunk.to_s
            loop do
              newline_idx = buffer.index("\n")
              break if newline_idx.nil?

              line = buffer.slice!(0..newline_idx).chomp

              next unless line.start_with?("data:")

              data = line[5..].to_s.strip
              next if data.empty? || data == "[DONE]"

              begin
                event = JSON.parse(data)
                on_event.call(event)
              rescue JSON::ParserError
                # Skip malformed events
              end
            end
          end
        end
      rescue Faraday::TimeoutError
        raise Superserve::TimeoutError.new("Stream timed out after #{timeout}s")
      rescue Faraday::ConnectionFailed => e
        raise Superserve::SandboxError.new("Stream error: #{e.message}")
      end

      # On error, `buffer` retains any unparsed content (typically the full
      # error JSON body, since error responses don't use `data:` framing).
      unless success?(response.status)
        raise Superserve.map_api_error(response.status, parse_error_body(buffer))
      end

      nil
    end

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    # @api private
    def self.do_request_with_retry(connection, method, url, body, headers, timeout)
      retryable = IDEMPOTENT_METHODS.include?(method)
      max_attempts = retryable ? MAX_ATTEMPTS : 1
      attempt = 1

      loop do
        begin
          response = connection.run_request(method, url, body, headers) do |req|
            req.options.timeout = timeout
            req.options.read_timeout = timeout
          end
        rescue Faraday::TimeoutError
          raise Superserve::TimeoutError.new("Request timed out after #{timeout}s")
        rescue Faraday::ConnectionFailed => e
          if !retryable || attempt >= max_attempts
            raise Superserve::SandboxError.new("Network error: #{e.message}")
          end
          sleep(compute_backoff(attempt))
          attempt += 1
          next
        end

        if retryable && RETRY_STATUS_CODES.include?(response.status) && attempt < max_attempts
          delay = nil
          if response.status == 429
            delay = parse_retry_after(response.headers["retry-after"] || response.headers["Retry-After"])
          end
          delay ||= compute_backoff(attempt)
          sleep(delay) if delay > 0
          attempt += 1
          next
        end

        return response
      end
    end

    # Exponential backoff with ±20% jitter, capped at MAX_BACKOFF.
    # Attempt 1 → ~100ms, 2 → ~200ms, 3 → ~400ms.
    # @api private
    def self.compute_backoff(attempt)
      base = BASE_BACKOFF * (2**(attempt - 1))
      jitter = base * (0.8 + rand * 0.4)
      [jitter, MAX_BACKOFF].min
    end

    # Parse a Retry-After header (numeric seconds or HTTP-date).
    # Returns seconds capped at MAX_BACKOFF, or nil if invalid.
    # @api private
    def self.parse_retry_after(value)
      return nil if value.nil?
      trimmed = value.to_s.strip
      return nil if trimmed.empty?

      begin
        seconds = Float(trimmed)
        return [[seconds, 0.0].max, MAX_BACKOFF].min
      rescue ArgumentError
      end

      begin
        dt = Time.httpdate(trimmed)
        delta = dt - Time.now
        return [[delta, 0.0].max, MAX_BACKOFF].min
      rescue ArgumentError
        nil
      end
    end

    # @api private
    def self.default_headers(extra, content_type: nil)
      h = { "User-Agent" => USER_AGENT }
      h["Content-Type"] = content_type if content_type
      h.merge(extra)
    end

    # @api private
    def self.parse_error_body(body)
      return {} if body.nil? || body.to_s.empty?
      parsed = JSON.parse(body.to_s)
      parsed.is_a?(Hash) ? parsed : {}
    rescue JSON::ParserError
      truncated = body.to_s[0, 500]
      { "error" => { "message" => truncated.empty? ? nil : truncated } }
    end

    # @api private
    def self.success?(status)
      status >= 200 && status < 300
    end
  end
end

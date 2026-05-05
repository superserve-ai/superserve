require "erb"

module Superserve
  # Template — reusable sandbox base image with build steps.
  #
  # Example:
  #   template = Superserve::Template.create(
  #     name: "my-python-env",
  #     from: "python:3.11",
  #     steps: [{ run: "pip install numpy" }],
  #   )
  #   template.wait_until_ready
  #   sandbox = Superserve::Sandbox.create(name: "run-1", from_template: template)
  class Template
    attr_reader :id, :name, :team_id, :status, :vcpu, :memory_mib, :disk_mib,
                :size_bytes, :error_message, :created_at, :built_at, :latest_build_id

    # @api private — use Template.create / Template.connect.
    def initialize(info, config)
      @id = info.id
      @name = info.name
      @team_id = info.team_id
      @status = info.status
      @vcpu = info.vcpu
      @memory_mib = info.memory_mib
      @disk_mib = info.disk_mib
      @size_bytes = info.size_bytes
      @error_message = info.error_message
      @created_at = info.created_at
      @built_at = info.built_at
      @latest_build_id = info.latest_build_id
      @config = config
    end

    # Create a template and kick off the first build.
    # `from:` accepts an OCI image reference (e.g. "python:3.11").
    def self.create(name:, from:, vcpu: nil, memory_mib: nil, disk_mib: nil,
                    steps: nil, start_cmd: nil, ready_cmd: nil,
                    api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)

      build_spec = { from: from }
      build_spec[:steps] = steps if steps
      build_spec[:start_cmd] = start_cmd if start_cmd
      build_spec[:ready_cmd] = ready_cmd if ready_cmd

      body = { name: name, build_spec: build_spec }
      body[:vcpu] = vcpu if vcpu
      body[:memory_mib] = memory_mib if memory_mib
      body[:disk_mib] = disk_mib if disk_mib

      raw = HTTP.api_request(
        :post,
        "#{config.base_url}/templates",
        headers: { "X-API-Key" => config.api_key },
        json_body: body
      )
      build_id = raw && raw["build_id"]
      unless build_id
        raise SandboxError.new("Invalid API response from POST /templates: missing build_id")
      end
      new(Superserve.to_template_info(raw, build_id), config)
    end

    # Connect to an existing template by name or ID.
    def self.connect(name_or_id, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      raw = HTTP.api_request(
        :get,
        "#{config.base_url}/templates/#{ERB::Util.url_encode(name_or_id)}",
        headers: { "X-API-Key" => config.api_key }
      )
      new(Superserve.to_template_info(raw), config)
    end

    # List all templates visible to the authenticated team.
    def self.list(name_prefix: nil, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      url = "#{config.base_url}/templates"
      url += "?name_prefix=#{ERB::Util.url_encode(name_prefix)}" if name_prefix
      raw = HTTP.api_request(:get, url, headers: { "X-API-Key" => config.api_key })
      raw.map { |t| Superserve.to_template_info(t) }
    end

    # Delete a template by name or ID. Idempotent on 404.
    def self.delete_by_id(name_or_id, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      HTTP.api_request(
        :delete,
        "#{config.base_url}/templates/#{ERB::Util.url_encode(name_or_id)}",
        headers: { "X-API-Key" => config.api_key }
      )
      nil
    rescue NotFoundError
      nil
    end

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    def get_info
      raw = HTTP.api_request(
        :get,
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}",
        headers: { "X-API-Key" => @config.api_key }
      )
      Superserve.to_template_info(raw)
    end

    # Delete this template. Idempotent on 404.
    # Raises ConflictError if sandboxes reference it.
    def delete
      HTTP.api_request(
        :delete,
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}",
        headers: { "X-API-Key" => @config.api_key }
      )
      nil
    rescue NotFoundError
      nil
    end

    # Queue a new build for this template. Idempotent on spec hash.
    def rebuild
      raw = HTTP.api_request(
        :post,
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds",
        headers: { "X-API-Key" => @config.api_key }
      )
      Superserve.to_template_build_info(raw)
    end

    def list_builds(limit: nil)
      url = "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds"
      url += "?limit=#{limit}" if limit
      raw = HTTP.api_request(:get, url, headers: { "X-API-Key" => @config.api_key })
      raw.map { |b| Superserve.to_template_build_info(b) }
    end

    def get_build(build_id)
      raw = HTTP.api_request(
        :get,
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds/#{ERB::Util.url_encode(build_id)}",
        headers: { "X-API-Key" => @config.api_key }
      )
      Superserve.to_template_build_info(raw)
    end

    def cancel_build(build_id)
      HTTP.api_request(
        :delete,
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds/#{ERB::Util.url_encode(build_id)}",
        headers: { "X-API-Key" => @config.api_key }
      )
      nil
    rescue NotFoundError
      nil
    end

    # Stream build logs (SSE) for this template.
    # Yields BuildLogEvent for each event, or accepts an `on_event:` proc.
    def stream_build_logs(on_event:, build_id: nil)
      bid = resolve_build_id(build_id)
      HTTP.stream_sse(
        "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds/#{ERB::Util.url_encode(bid)}/logs",
        headers: { "X-API-Key" => @config.api_key },
        method: :get
      ) do |raw|
        on_event.call(Superserve.to_build_log_event(raw))
      end
    end

    # Block until the build reaches terminal state.
    #
    # Polls `GET /templates/{id}/builds/{bid}` (the DB-backed build row) as
    # the source of truth. SSE is only used for live log delivery when
    # `on_log:` is passed (it is consumed first; the stream returns when
    # the build emits its terminal event).
    #
    # Raises BuildError on `failed`, ConflictError on `cancelled`.
    def wait_until_ready(on_log: nil, poll_interval_s: 2.0)
      bid = nil
      begin
        bid = resolve_build_id(nil)
      rescue SandboxError
        bid = nil
      end

      # SSE for live logs only. The server emits `finished:true,
      # status:"ready"` the instant the builder finishes, but the DB row
      # that POST /sandboxes reads is updated by a separate ~1s poller.
      # Treating SSE as the terminal-state signal would race that update
      # and leave callers seeing 409 "template is not ready" on the very
      # next request. Source of truth is the DB-backed build endpoint.
      if bid && on_log
        begin
          HTTP.stream_sse(
            "#{@config.base_url}/templates/#{ERB::Util.url_encode(@id)}/builds/#{ERB::Util.url_encode(bid)}/logs",
            headers: { "X-API-Key" => @config.api_key },
            method: :get
          ) do |raw|
            on_log.call(Superserve.to_build_log_event(raw))
          end
        rescue StandardError
          # SSE failures are non-fatal — polling drives terminal detection.
        end
      end

      if bid
        loop do
          build = get_build(bid)
          case build.status
          when TemplateBuildStatus::READY
            return get_info
          when TemplateBuildStatus::FAILED
            code, msg = self.class.send(:parse_build_error, build.error_message)
            raise BuildError.new(msg, code: code, build_id: bid, template_id: @id)
          when TemplateBuildStatus::CANCELLED
            raise ConflictError.new("template build was cancelled", code: "cancelled")
          end
          sleep(poll_interval_s)
        end
      end

      # No build_id — rare path; poll template status as a best effort.
      loop do
        info = get_info
        case info.status
        when TemplateStatus::READY
          return info
        when TemplateStatus::FAILED
          code, msg = self.class.send(:parse_build_error, info.error_message)
          raise BuildError.new(msg, code: code, build_id: "", template_id: @id)
        end
        sleep(poll_interval_s)
      end
    end

    def to_s
      "#<Superserve::Template id=#{@id.inspect} name=#{@name.inspect} status=#{@status.inspect}>"
    end
    alias inspect to_s

    # @api private
    def self.parse_build_error(msg)
      return ["build_failed", "Template build failed"] if msg.nil? || msg.empty?
      match = /\A(\w+):\s*(.*)\z/m.match(msg)
      if match && !match[2].strip.empty?
        [match[1], match[2].strip]
      else
        ["build_failed", msg]
      end
    end

    private

    def resolve_build_id(build_id)
      return build_id if build_id
      return @latest_build_id if @latest_build_id
      recent = list_builds(limit: 1)
      if recent.empty?
        raise SandboxError.new("Template #{@name} has no builds — call rebuild first")
      end
      recent.first.id
    end
  end
end

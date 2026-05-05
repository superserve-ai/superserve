require "erb"

module Superserve
  # `sandbox.files` — read and write files inside a sandbox.
  #
  # Hits the data-plane directly at `boxd-{id}.sandbox.superserve.ai`
  # using the per-sandbox access token. The control-plane API key is
  # not used for file operations.
  class Files
    # @api private
    def initialize(sandbox_id, sandbox_host, access_token, connection: nil)
      @base_url = Superserve.data_plane_url(sandbox_id, sandbox_host)
      @access_token = access_token
      @connection = connection
    end

    # Write a file to the sandbox at the given absolute path.
    # Parent directories are created automatically by the sandbox agent.
    # The path must start with `/` and must not contain `..` segments.
    def write(path, content, timeout: nil)
      self.class.validate_path!(path)
      bytes = content.is_a?(String) ? content.b : content
      url = "#{@base_url}/files?path=#{ERB::Util.url_encode(path)}"
      kwargs = {
        headers: { "X-Access-Token" => @access_token },
        content: bytes,
        connection: @connection
      }
      kwargs[:timeout] = timeout if timeout
      HTTP.upload_bytes(url, **kwargs)
    end

    # Read a file from the sandbox as raw bytes (binary string).
    def read(path, timeout: nil)
      self.class.validate_path!(path)
      url = "#{@base_url}/files?path=#{ERB::Util.url_encode(path)}"
      kwargs = {
        headers: { "X-Access-Token" => @access_token },
        connection: @connection
      }
      kwargs[:timeout] = timeout if timeout
      HTTP.download_bytes(url, **kwargs)
    end

    # Read a file from the sandbox as a UTF-8 string.
    def read_text(path, timeout: nil)
      bytes = read(path, timeout: timeout)
      bytes.force_encoding(Encoding::UTF_8)
    end

    # @api private
    def self.validate_path!(path)
      unless path.is_a?(String) && path.start_with?("/")
        raise ValidationError.new("Path must start with \"/\": #{path}")
      end
      if path.split("/").include?("..")
        raise ValidationError.new("Path must not contain \"..\" segments: #{path}")
      end
    end
  end
end

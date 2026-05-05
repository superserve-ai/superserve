require "erb"

module Superserve
  # Main Sandbox class — primary entry point for the Superserve SDK.
  #
  # Static factory methods (create/connect/list) return a sandbox.
  # Call methods on it directly (`sandbox.commands.run(...)`,
  # `sandbox.files.write(...)`, etc.).
  #
  # Example:
  #   sandbox = Superserve::Sandbox.create(name: "my-sandbox")
  #   result = sandbox.commands.run("echo hello")
  #   sandbox.files.write("/app/data.txt", "content")
  #   sandbox.kill
  class Sandbox
    attr_reader :id, :name, :status, :metadata, :commands, :files

    # @api private — use Sandbox.create / Sandbox.connect.
    def initialize(info, access_token, config)
      @id = info.id
      @name = info.name
      @status = info.status
      @metadata = info.metadata
      @access_token = access_token
      @config = config
      @connection = HTTP.build_connection
      @closed = false

      @commands = Commands.new(config.base_url, @id, config.api_key, connection: @connection)
      @files = Files.new(@id, config.sandbox_host, @access_token, connection: @connection)
    end

    # Create a new sandbox. The request is synchronous: once it returns, the
    # sandbox is `active` and ready to execute commands and file operations.
    def self.create(name:, from_template: nil, from_snapshot: nil, timeout_seconds: nil,
                    metadata: nil, env_vars: nil, network: nil,
                    api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)

      body = { name: name }
      if from_template
        body[:from_template] =
          if from_template.is_a?(String)
            from_template
          elsif from_template.respond_to?(:name) && from_template.name
            from_template.name
          else
            from_template.id
          end
      end
      body[:from_snapshot] = from_snapshot if from_snapshot
      body[:timeout_seconds] = timeout_seconds if timeout_seconds
      body[:metadata] = metadata if metadata
      body[:env_vars] = env_vars if env_vars
      body[:network] = serialize_network(network) if network

      raw = HTTP.api_request(
        :post,
        "#{config.base_url}/sandboxes",
        headers: { "X-API-Key" => config.api_key },
        json_body: body
      )

      token = raw && raw["access_token"]
      unless token
        raise SandboxError.new("Invalid API response from POST /sandboxes: missing access_token")
      end

      new(Superserve.to_sandbox_info(raw), token, config)
    end

    # Connect to an existing sandbox by ID.
    def self.connect(sandbox_id, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      raw = HTTP.api_request(
        :get,
        "#{config.base_url}/sandboxes/#{sandbox_id}",
        headers: { "X-API-Key" => config.api_key }
      )
      token = raw && raw["access_token"]
      unless token
        raise SandboxError.new("Invalid API response from GET /sandboxes/{id}: missing access_token")
      end
      new(Superserve.to_sandbox_info(raw), token, config)
    end

    # List all sandboxes belonging to the authenticated team.
    def self.list(metadata: nil, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      url = "#{config.base_url}/sandboxes"
      if metadata && !metadata.empty?
        params = metadata.map { |k, v| "metadata.#{ERB::Util.url_encode(k.to_s)}=#{ERB::Util.url_encode(v.to_s)}" }.join("&")
        url += "?#{params}"
      end
      raw = HTTP.api_request(:get, url, headers: { "X-API-Key" => config.api_key })
      raw.map { |item| Superserve.to_sandbox_info(item) }
    end

    # Delete a sandbox by ID. Idempotent: a 404 is swallowed.
    def self.kill_by_id(sandbox_id, api_key: nil, base_url: nil)
      config = Superserve.resolve_config(api_key: api_key, base_url: base_url)
      HTTP.api_request(
        :delete,
        "#{config.base_url}/sandboxes/#{sandbox_id}",
        headers: { "X-API-Key" => config.api_key }
      )
      nil
    rescue NotFoundError
      nil
    end

    # @api private
    def self.serialize_network(network)
      if network.respond_to?(:allow_out)
        { allow_out: network.allow_out, deny_out: network.deny_out }
      else
        { allow_out: network[:allow_out], deny_out: network[:deny_out] }
      end
    end

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    # Refresh this sandbox's info from the API.
    # The instance's own `status`/`metadata` properties are snapshots from
    # construction and are not mutated — use the return value.
    def get_info
      require_live!
      raw = HTTP.api_request(
        :get,
        "#{@config.base_url}/sandboxes/#{@id}",
        headers: { "X-API-Key" => @config.api_key },
        connection: @connection
      )
      Superserve.to_sandbox_info(raw)
    end

    # Pause this sandbox. Running processes and file state are preserved.
    def pause
      require_live!
      HTTP.api_request(
        :post,
        "#{@config.base_url}/sandboxes/#{@id}/pause",
        headers: { "X-API-Key" => @config.api_key },
        connection: @connection
      )
      nil
    end

    # Resume a paused sandbox. The access token is rotated; `sandbox.files`
    # is rebuilt with the fresh token transparently.
    def resume
      require_live!
      raw = HTTP.api_request(
        :post,
        "#{@config.base_url}/sandboxes/#{@id}/resume",
        headers: { "X-API-Key" => @config.api_key },
        connection: @connection
      )
      token = raw && raw["access_token"]
      unless token
        raise SandboxError.new(
          "Invalid API response from POST /sandboxes/{id}/resume: missing access_token"
        )
      end
      @access_token = token
      @files = Files.new(@id, @config.sandbox_host, @access_token, connection: @connection)
      nil
    end

    # Delete this sandbox and all its resources. Idempotent.
    def kill
      return nil if @closed
      begin
        HTTP.api_request(
          :delete,
          "#{@config.base_url}/sandboxes/#{@id}",
          headers: { "X-API-Key" => @config.api_key },
          connection: @connection
        )
      rescue NotFoundError
        # Already deleted
      ensure
        @closed = true
      end
      nil
    end

    # Partially update this sandbox (metadata, network rules).
    def update(metadata: nil, network: nil)
      require_live!
      body = {}
      body[:metadata] = metadata if metadata
      body[:network] = self.class.serialize_network(network) if network

      HTTP.api_request(
        :patch,
        "#{@config.base_url}/sandboxes/#{@id}",
        headers: { "X-API-Key" => @config.api_key },
        json_body: body,
        connection: @connection
      )
      nil
    end

    def to_s
      "#<Superserve::Sandbox id=#{@id.inspect} name=#{@name.inspect} status=#{@status.inspect}>"
    end
    alias inspect to_s

    private

    def require_live!
      return unless @closed
      raise SandboxError.new(
        "Sandbox #{@id.inspect} has been deleted; create or connect to a new one."
      )
    end
  end
end

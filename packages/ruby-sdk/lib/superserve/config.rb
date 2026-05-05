require "uri"

module Superserve
  DEFAULT_BASE_URL = "https://api.superserve.ai".freeze
  DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai".freeze

  ResolvedConfig = Data.define(:api_key, :base_url, :sandbox_host)

  # Resolve connection config from explicit args + environment variables.
  #
  # Priority: explicit option > SUPERSERVE_API_KEY / SUPERSERVE_BASE_URL env vars.
  # Raises AuthenticationError if no API key can be resolved.
  def self.resolve_config(api_key: nil, base_url: nil)
    resolved_key = api_key || ENV["SUPERSERVE_API_KEY"]
    if resolved_key.nil? || resolved_key.empty?
      raise AuthenticationError.new(
        "Missing API key. Pass `api_key:` or set the SUPERSERVE_API_KEY environment variable."
      )
    end

    resolved_url = base_url || ENV["SUPERSERVE_BASE_URL"] || DEFAULT_BASE_URL
    sandbox_host = derive_sandbox_host(resolved_url)
    ResolvedConfig.new(api_key: resolved_key, base_url: resolved_url, sandbox_host: sandbox_host)
  end

  # Build the data-plane base URL for a specific sandbox.
  #
  # Example: `https://boxd-{sandboxId}.sandbox.superserve.ai`
  def self.data_plane_url(sandbox_id, sandbox_host)
    "https://boxd-#{sandbox_id}.#{sandbox_host}"
  end

  # @api private
  def self.derive_sandbox_host(base_url)
    uri = URI.parse(base_url)
    case uri.host
    when "api.superserve.ai" then DEFAULT_SANDBOX_HOST
    when "api-staging.superserve.ai" then "sandbox-staging.superserve.ai"
    else DEFAULT_SANDBOX_HOST
    end
  rescue URI::InvalidURIError
    DEFAULT_SANDBOX_HOST
  end
end

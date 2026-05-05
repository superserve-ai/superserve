module Superserve
  class SandboxError < StandardError
    attr_reader :status_code, :code

    def initialize(message, status_code: nil, code: nil)
      super(message)
      @status_code = status_code
      @code = code
    end
  end

  class AuthenticationError < SandboxError
    def initialize(message = "Missing or invalid API key", code: nil, status_code: 401)
      super(message, status_code: status_code, code: code)
    end
  end

  class ValidationError < SandboxError
    def initialize(message, code: nil)
      super(message, status_code: 400, code: code)
    end
  end

  class NotFoundError < SandboxError
    def initialize(message = "Resource not found", code: nil)
      super(message, status_code: 404, code: code)
    end
  end

  class ConflictError < SandboxError
    def initialize(message = "Sandbox is not in a valid state for this operation", code: nil)
      super(message, status_code: 409, code: code)
    end
  end

  # 429 from the API. ``code`` distinguishes the variant:
  # - ``rate_limited`` — request rate exceeded; retry after a short backoff.
  # - ``too_many_builds`` — team has reached its concurrent build limit.
  # - ``too_many_templates`` — team has reached its total template count limit.
  # - ``too_many_sandboxes`` — team has reached its active sandbox count limit.
  class RateLimitError < SandboxError
    def initialize(message = "Rate limit exceeded", code: nil)
      super(message, status_code: 429, code: code)
    end
  end

  class ServerError < SandboxError
    def initialize(message = "Internal server error", code: nil)
      super(message, status_code: 500, code: code)
    end
  end

  class TimeoutError < SandboxError
    def initialize(message = "Request timed out")
      super(message)
    end
  end

  # Raised when a template build transitions to status 'failed'.
  # `code` is the stable error prefix on `error_message`
  # (e.g. `image_pull_failed`, `step_failed`, `boot_failed`,
  # `snapshot_failed`, `start_cmd_failed`, `ready_cmd_failed`, `build_failed`).
  class BuildError < SandboxError
    attr_reader :build_id, :template_id

    def initialize(message, code:, build_id:, template_id:, status_code: nil)
      super(message, status_code: status_code, code: code)
      @build_id = build_id
      @template_id = template_id
    end
  end

  # @api private
  def self.map_api_error(status_code, body)
    error_data = body.is_a?(Hash) ? (body["error"] || {}) : {}
    error_data = {} unless error_data.is_a?(Hash)
    message = error_data["message"] || "API error (#{status_code})"
    code = error_data["code"]

    case status_code
    when 400
      ValidationError.new(message, code: code)
    when 401, 403
      AuthenticationError.new(message, code: code, status_code: status_code)
    when 404
      NotFoundError.new(message, code: code)
    when 409
      ConflictError.new(message, code: code)
    when 429
      RateLimitError.new(message, code: code)
    else
      if status_code >= 500
        ServerError.new(message, code: code)
      else
        SandboxError.new(message, status_code: status_code, code: code)
      end
    end
  end
end

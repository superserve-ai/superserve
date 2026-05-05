module Superserve
  # `sandbox.commands` — run shell commands inside a sandbox.
  #
  # Two modes:
  # - Synchronous: waits for the command to finish, returns stdout/stderr/exit_code.
  # - Streaming: when on_stdout / on_stderr callbacks are passed, fires them via
  #   SSE and returns the aggregated result at the end.
  #
  # Paused sandboxes are transparently resumed by the platform before execution.
  class Commands
    # @api private
    def initialize(base_url, sandbox_id, api_key, connection: nil)
      @base_url = base_url
      @sandbox_id = sandbox_id
      @api_key = api_key
      @connection = connection
    end

    def run(command, cwd: nil, env: nil, timeout_seconds: nil, on_stdout: nil, on_stderr: nil)
      body = { command: command }
      body[:working_dir] = cwd if cwd
      body[:env] = env if env
      body[:timeout_s] = timeout_seconds if timeout_seconds

      headers = { "X-API-Key" => @api_key }
      streaming = on_stdout || on_stderr

      if streaming
        run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
      else
        run_sync(body, headers, timeout_seconds)
      end
    end

    private

    def run_sync(body, headers, timeout_seconds)
      effective_timeout = timeout_seconds ? timeout_seconds + 5 : HTTP::DEFAULT_TIMEOUT
      raw = HTTP.api_request(
        :post,
        "#{@base_url}/sandboxes/#{@sandbox_id}/exec",
        headers: headers,
        json_body: body,
        timeout: effective_timeout,
        connection: @connection
      )
      CommandResult.new(
        stdout: raw["stdout"] || "",
        stderr: raw["stderr"] || "",
        exit_code: raw["exit_code"] || 0
      )
    end

    def run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
      stdout_parts = []
      stderr_parts = []
      exit_code = 0
      saw_finished = false
      effective_timeout = timeout_seconds ? timeout_seconds + 5 : HTTP::DEFAULT_STREAM_TIMEOUT

      HTTP.stream_sse(
        "#{@base_url}/sandboxes/#{@sandbox_id}/exec/stream",
        headers: headers,
        json_body: body,
        timeout: effective_timeout,
        connection: @connection
      ) do |event|
        if event["stdout"]
          stdout_parts << event["stdout"]
          on_stdout&.call(event["stdout"])
        end
        if event["stderr"]
          stderr_parts << event["stderr"]
          on_stderr&.call(event["stderr"])
        end
        if event["finished"]
          saw_finished = true
          exit_code = event["exit_code"] || 0
          stderr_parts << event["error"] if event["error"]
        end
      end

      unless saw_finished
        raise SandboxError.new(
          "Command stream ended without a finished event (possible network disconnect)"
        )
      end

      CommandResult.new(
        stdout: stdout_parts.join,
        stderr: stderr_parts.join,
        exit_code: exit_code
      )
    end
  end
end

RSpec.describe Superserve::Commands do
  let(:commands) { described_class.new("https://api.test.local", "sb_1", "ss_live_test_key") }

  describe "sync mode" do
    it "POSTs to /exec and returns CommandResult" do
      stub = stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec")
        .with(
          body: { command: "echo hi" }.to_json,
          headers: { "X-API-Key" => "ss_live_test_key", "Content-Type" => "application/json" }
        )
        .to_return(status: 200, body: { stdout: "hi\n", stderr: "", exit_code: 0 }.to_json)
      result = commands.run("echo hi")
      expect(stub).to have_been_requested
      expect(result.stdout).to eq("hi\n")
      expect(result.exit_code).to eq(0)
    end

    it "passes cwd, env, timeout_s in body" do
      stub = stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec")
        .with(body: { command: "ls", working_dir: "/app", env: { "X" => "1" }, timeout_s: 60 }.to_json)
        .to_return(status: 200, body: { stdout: "", stderr: "", exit_code: 0 }.to_json)
      commands.run("ls", cwd: "/app", env: { "X" => "1" }, timeout_seconds: 60)
      expect(stub).to have_been_requested
    end

    it "fills defaults when fields are absent in response" do
      stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec")
        .to_return(status: 200, body: "{}")
      result = commands.run("x")
      expect(result.stdout).to eq("")
      expect(result.stderr).to eq("")
      expect(result.exit_code).to eq(0)
    end
  end

  describe "streaming mode" do
    let(:sse_body) {
      [
        %(data: {"stdout":"hello\\n"}),
        %(data: {"stderr":"warn\\n"}),
        %(data: {"finished":true,"exit_code":0}),
        ""
      ].join("\n")
    }

    it "fires on_stdout/on_stderr and aggregates result" do
      stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec/stream")
        .to_return(status: 200, body: sse_body, headers: { "Content-Type" => "text/event-stream" })

      seen_stdout = []
      seen_stderr = []
      result = commands.run(
        "x",
        on_stdout: ->(d) { seen_stdout << d },
        on_stderr: ->(d) { seen_stderr << d }
      )

      expect(seen_stdout.join).to eq("hello\n")
      expect(seen_stderr.join).to eq("warn\n")
      expect(result.stdout).to eq("hello\n")
      expect(result.stderr).to eq("warn\n")
      expect(result.exit_code).to eq(0)
    end

    it "raises if stream ends without a finished event" do
      truncated = [
        %(data: {"stdout":"hi"}),
        ""
      ].join("\n")
      stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec/stream")
        .to_return(status: 200, body: truncated)

      expect {
        commands.run("x", on_stdout: ->(_) {})
      }.to raise_error(Superserve::SandboxError, /finished event/)
    end

    it "appends finished-event error into stderr" do
      body = [
        %(data: {"finished":true,"exit_code":137,"error":"killed"}),
        ""
      ].join("\n")
      stub_request(:post, "https://api.test.local/sandboxes/sb_1/exec/stream")
        .to_return(status: 200, body: body)

      result = commands.run("x", on_stdout: ->(_) {})
      expect(result.exit_code).to eq(137)
      expect(result.stderr).to eq("killed")
    end
  end
end

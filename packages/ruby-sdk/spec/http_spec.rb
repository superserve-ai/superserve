RSpec.describe Superserve::HTTP do
  describe ".compute_backoff" do
    it "scales with attempt and stays within ±20% of base" do
      [
        [1, 0.1],
        [2, 0.2],
        [3, 0.4]
      ].each do |attempt, expected_base|
        50.times do
          v = described_class.compute_backoff(attempt)
          expect(v).to be >= expected_base * 0.8
          expect(v).to be <= expected_base * 1.2 + 1e-9
        end
      end
    end

    it "caps at MAX_BACKOFF" do
      v = described_class.compute_backoff(20) # 0.1 * 2^19 way over cap
      expect(v).to be <= Superserve::HTTP::MAX_BACKOFF
    end
  end

  describe ".parse_retry_after" do
    it "parses numeric seconds" do
      expect(described_class.parse_retry_after("5")).to eq(5.0)
    end

    it "parses HTTP-date" do
      future = (Time.now + 30).httpdate
      v = described_class.parse_retry_after(future)
      expect(v).to be > 0
      expect(v).to be <= 30
    end

    it "returns 0 for past dates" do
      past = (Time.now - 100).httpdate
      expect(described_class.parse_retry_after(past)).to eq(0.0)
    end

    it "caps at MAX_BACKOFF" do
      expect(described_class.parse_retry_after("999999")).to eq(Superserve::HTTP::MAX_BACKOFF)
    end

    it "returns nil for invalid values" do
      expect(described_class.parse_retry_after(nil)).to be_nil
      expect(described_class.parse_retry_after("")).to be_nil
      expect(described_class.parse_retry_after("garbage")).to be_nil
    end
  end

  describe ".api_request" do
    it "returns parsed JSON on 2xx" do
      stub_request(:get, "https://api.test.local/x")
        .to_return(status: 200, body: '{"ok":true}', headers: { "Content-Type" => "application/json" })

      result = described_class.api_request(:get, "https://api.test.local/x", headers: {})
      expect(result).to eq({ "ok" => true })
    end

    it "returns nil for 204" do
      stub_request(:post, "https://api.test.local/x").to_return(status: 204)
      expect(described_class.api_request(:post, "https://api.test.local/x", headers: {})).to be_nil
    end

    it "raises mapped error on non-2xx" do
      stub_request(:get, "https://api.test.local/missing")
        .to_return(status: 404, body: '{"error":{"message":"nope"}}')
      expect {
        described_class.api_request(:get, "https://api.test.local/missing", headers: {})
      }.to raise_error(Superserve::NotFoundError, /nope/)
    end

    it "retries GET on 503 and succeeds on second attempt" do
      stub_request(:get, "https://api.test.local/flaky")
        .to_return({ status: 503, body: "{}" }, { status: 200, body: '{"ok":1}' })

      allow(described_class).to receive(:compute_backoff).and_return(0)
      result = described_class.api_request(:get, "https://api.test.local/flaky", headers: {})
      expect(result).to eq({ "ok" => 1 })
      expect(WebMock).to have_requested(:get, "https://api.test.local/flaky").times(2)
    end

    it "does NOT retry POST on 503 (not idempotent)" do
      stub_request(:post, "https://api.test.local/post-flaky")
        .to_return(status: 503, body: '{"error":{"message":"down"}}')
      allow(described_class).to receive(:compute_backoff).and_return(0)
      expect {
        described_class.api_request(:post, "https://api.test.local/post-flaky", headers: {}, json_body: {})
      }.to raise_error(Superserve::ServerError)
      expect(WebMock).to have_requested(:post, "https://api.test.local/post-flaky").once
    end

    it "honors Retry-After header on 429" do
      stub_request(:get, "https://api.test.local/limited").to_return(
        { status: 429, headers: { "Retry-After" => "0" }, body: "{}" },
        { status: 200, body: '{"ok":1}' }
      )
      allow(described_class).to receive(:compute_backoff).and_return(0)
      result = described_class.api_request(:get, "https://api.test.local/limited", headers: {})
      expect(result).to eq({ "ok" => 1 })
    end

    it "stops after MAX_ATTEMPTS retries" do
      stub_request(:get, "https://api.test.local/dead").to_return(status: 503, body: "{}")
      allow(described_class).to receive(:compute_backoff).and_return(0)
      expect {
        described_class.api_request(:get, "https://api.test.local/dead", headers: {})
      }.to raise_error(Superserve::ServerError)
      expect(WebMock).to have_requested(:get, "https://api.test.local/dead")
        .times(Superserve::HTTP::MAX_ATTEMPTS)
    end

    it "sets the User-Agent header" do
      stub = stub_request(:get, "https://api.test.local/ua").to_return(status: 200, body: "{}")
      described_class.api_request(:get, "https://api.test.local/ua", headers: {})
      expect(stub).to have_been_requested
      expect(WebMock).to have_requested(:get, "https://api.test.local/ua")
        .with(headers: { "User-Agent" => Superserve::HTTP::USER_AGENT })
    end
  end

  describe ".upload_bytes" do
    it "POSTs raw bytes with octet-stream content-type" do
      stub = stub_request(:post, "https://boxd-x.sandbox.superserve.ai/files?path=%2Fa")
        .with(headers: { "Content-Type" => "application/octet-stream" }, body: "hello")
        .to_return(status: 204)
      described_class.upload_bytes(
        "https://boxd-x.sandbox.superserve.ai/files?path=%2Fa",
        headers: {},
        content: "hello"
      )
      expect(stub).to have_been_requested
    end

    it "does NOT retry on 503 (POST is non-idempotent)" do
      stub_request(:post, "https://x.test/up").to_return(status: 503, body: "{}")
      expect {
        described_class.upload_bytes("https://x.test/up", headers: {}, content: "x")
      }.to raise_error(Superserve::ServerError)
      expect(WebMock).to have_requested(:post, "https://x.test/up").once
    end
  end

  describe ".download_bytes" do
    it "GETs raw bytes" do
      stub_request(:get, "https://x.test/dl").to_return(status: 200, body: "binary data")
      result = described_class.download_bytes("https://x.test/dl", headers: {})
      expect(result).to eq("binary data")
    end

    it "retries on transient failures" do
      stub_request(:get, "https://x.test/dl-flaky").to_return(
        { status: 502, body: "" },
        { status: 200, body: "ok" }
      )
      allow(described_class).to receive(:compute_backoff).and_return(0)
      expect(described_class.download_bytes("https://x.test/dl-flaky", headers: {})).to eq("ok")
    end
  end
end

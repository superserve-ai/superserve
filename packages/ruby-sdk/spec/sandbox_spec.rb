RSpec.describe Superserve::Sandbox do
  let(:base) { "https://api.test.local" }

  describe ".create" do
    it "POSTs to /sandboxes and returns a sandbox" do
      stub_request(:post, "#{base}/sandboxes")
        .with(
          body: { name: "test" }.to_json,
          headers: { "X-API-Key" => "ss_live_test_key" }
        )
        .to_return(status: 200, body: sandbox_response.to_json)
      sandbox = described_class.create(name: "test")
      expect(sandbox).to be_a(Superserve::Sandbox)
      expect(sandbox.id).to eq("sb_123")
      expect(sandbox.commands).to be_a(Superserve::Commands)
      expect(sandbox.files).to be_a(Superserve::Files)
    end

    it "passes optional fields when provided" do
      stub = stub_request(:post, "#{base}/sandboxes")
        .with(body: hash_including(
          "name" => "x",
          "from_template" => "node22",
          "timeout_seconds" => 600,
          "metadata" => { "k" => "v" },
          "env_vars" => { "FOO" => "bar" }
        ))
        .to_return(status: 200, body: sandbox_response.to_json)
      described_class.create(
        name: "x",
        from_template: "node22",
        timeout_seconds: 600,
        metadata: { "k" => "v" },
        env_vars: { "FOO" => "bar" }
      )
      expect(stub).to have_been_requested
    end

    it "raises when access_token is missing" do
      stub_request(:post, "#{base}/sandboxes")
        .to_return(status: 200, body: sandbox_response.merge("access_token" => nil).to_json)
      expect {
        described_class.create(name: "x")
      }.to raise_error(Superserve::SandboxError, /missing access_token/)
    end
  end

  describe ".connect" do
    it "GETs /sandboxes/{id}" do
      stub_request(:get, "#{base}/sandboxes/sb_xyz")
        .to_return(status: 200, body: sandbox_response("id" => "sb_xyz").to_json)
      sandbox = described_class.connect("sb_xyz")
      expect(sandbox.id).to eq("sb_xyz")
    end
  end

  describe ".list" do
    it "GETs /sandboxes and maps results" do
      stub_request(:get, "#{base}/sandboxes")
        .to_return(status: 200, body: [sandbox_response].to_json)
      list = described_class.list
      expect(list.length).to eq(1)
      expect(list.first.id).to eq("sb_123")
    end

    it "encodes metadata filter as query params" do
      stub = stub_request(:get, "#{base}/sandboxes?metadata.env=prod")
        .to_return(status: 200, body: "[]")
      described_class.list(metadata: { "env" => "prod" })
      expect(stub).to have_been_requested
    end
  end

  describe ".kill_by_id" do
    it "DELETEs and is idempotent on 404" do
      stub_request(:delete, "#{base}/sandboxes/sb_xyz").to_return(status: 404, body: "{}")
      expect { described_class.kill_by_id("sb_xyz") }.not_to raise_error
    end

    it "raises on non-404 errors" do
      stub_request(:delete, "#{base}/sandboxes/sb_xyz").to_return(status: 500, body: "{}")
      expect { described_class.kill_by_id("sb_xyz") }.to raise_error(Superserve::ServerError)
    end
  end

  describe "instance lifecycle" do
    let(:sandbox) {
      stub_request(:post, "#{base}/sandboxes").to_return(status: 200, body: sandbox_response.to_json)
      described_class.create(name: "x")
    }

    it "#pause sends POST /pause" do
      stub = stub_request(:post, "#{base}/sandboxes/sb_123/pause").to_return(status: 204)
      sandbox.pause
      expect(stub).to have_been_requested
    end

    it "#resume rotates the access token and rebuilds files" do
      stub_request(:post, "#{base}/sandboxes/sb_123/resume")
        .to_return(status: 200, body: { "id" => "sb_123", "status" => "active", "access_token" => "tok_new" }.to_json)
      original_files = sandbox.files
      sandbox.resume
      expect(sandbox.files).not_to equal(original_files)
    end

    it "#kill is idempotent on 404 and marks closed" do
      stub_request(:delete, "#{base}/sandboxes/sb_123").to_return(status: 404)
      sandbox.kill
      expect { sandbox.pause }.to raise_error(Superserve::SandboxError, /has been deleted/)
    end

    it "#kill swallows 404 silently" do
      stub_request(:delete, "#{base}/sandboxes/sb_123").to_return(status: 404)
      expect { sandbox.kill }.not_to raise_error
    end

    it "#update PATCHes metadata and network" do
      stub = stub_request(:patch, "#{base}/sandboxes/sb_123")
        .with(body: hash_including("metadata" => { "k" => "v" }))
        .to_return(status: 204)
      sandbox.update(metadata: { "k" => "v" })
      expect(stub).to have_been_requested
    end

    it "#get_info returns fresh info" do
      stub_request(:get, "#{base}/sandboxes/sb_123").to_return(status: 200, body: sandbox_response("status" => "paused").to_json)
      info = sandbox.get_info
      expect(info.status).to eq("paused")
      expect(sandbox.status).to eq("active") # snapshot is unchanged
    end
  end
end

RSpec.describe Superserve::Template do
  let(:base) { "https://api.test.local" }

  describe ".create" do
    it "POSTs build_spec and captures latest_build_id" do
      stub = stub_request(:post, "#{base}/templates")
        .with(body: hash_including(
          "name" => "x",
          "build_spec" => hash_including("from" => "python:3.11", "steps" => [{ "run" => "pip install numpy" }])
        ))
        .to_return(status: 200, body: template_response.merge("build_id" => "build_xyz").to_json)
      tpl = described_class.create(
        name: "x",
        from: "python:3.11",
        steps: [{ run: "pip install numpy" }]
      )
      expect(stub).to have_been_requested
      expect(tpl.latest_build_id).to eq("build_xyz")
    end

    it "raises when build_id is missing" do
      stub_request(:post, "#{base}/templates")
        .to_return(status: 200, body: template_response.to_json)
      expect {
        described_class.create(name: "x", from: "y")
      }.to raise_error(Superserve::SandboxError, /missing build_id/)
    end
  end

  describe ".connect" do
    it "GETs by name (URL-encoded)" do
      stub = stub_request(:get, "#{base}/templates/my%20tpl")
        .to_return(status: 200, body: template_response.to_json)
      described_class.connect("my tpl")
      expect(stub).to have_been_requested
    end
  end

  describe "#wait_until_ready" do
    let(:template) {
      stub_request(:post, "#{base}/templates")
        .to_return(status: 200, body: template_response.merge("build_id" => "bld_1").to_json)
      described_class.create(name: "x", from: "y")
    }

    it "returns TemplateInfo when build status reaches ready" do
      stub_request(:get, "#{base}/templates/tpl_123/builds/bld_1")
        .to_return(
          { status: 200, body: build_response("status" => "building").to_json },
          { status: 200, body: build_response("status" => "ready").to_json }
        )
      stub_request(:get, "#{base}/templates/tpl_123")
        .to_return(status: 200, body: template_response.to_json)

      info = template.wait_until_ready(poll_interval_s: 0)
      expect(info).to be_a(Superserve::TemplateInfo)
    end

    it "raises BuildError on failed build with parsed code" do
      stub_request(:get, "#{base}/templates/tpl_123/builds/bld_1")
        .to_return(status: 200, body: build_response(
          "status" => "failed",
          "error_message" => "step_failed: command exited 1"
        ).to_json)

      expect {
        template.wait_until_ready(poll_interval_s: 0)
      }.to raise_error(Superserve::BuildError) { |e|
        expect(e.code).to eq("step_failed")
        expect(e.message).to eq("command exited 1")
        expect(e.build_id).to eq("bld_1")
        expect(e.template_id).to eq("tpl_123")
      }
    end

    it "raises ConflictError when build is cancelled" do
      stub_request(:get, "#{base}/templates/tpl_123/builds/bld_1")
        .to_return(status: 200, body: build_response("status" => "cancelled").to_json)

      expect {
        template.wait_until_ready(poll_interval_s: 0)
      }.to raise_error(Superserve::ConflictError, /cancelled/)
    end
  end

  describe ".parse_build_error" do
    it "splits 'code: detail' format" do
      code, msg = described_class.send(:parse_build_error, "image_pull_failed: registry timeout")
      expect(code).to eq("image_pull_failed")
      expect(msg).to eq("registry timeout")
    end

    it "falls back to build_failed when message has no prefix" do
      code, msg = described_class.send(:parse_build_error, "something went wrong")
      expect(code).to eq("build_failed")
      expect(msg).to eq("something went wrong")
    end

    it "uses defaults for nil error_message" do
      code, msg = described_class.send(:parse_build_error, nil)
      expect(code).to eq("build_failed")
      expect(msg).to eq("Template build failed")
    end
  end
end

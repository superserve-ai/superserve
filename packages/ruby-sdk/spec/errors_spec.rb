RSpec.describe "Superserve errors" do
  describe "class hierarchy" do
    it "all derive from SandboxError" do
      [
        Superserve::AuthenticationError,
        Superserve::ValidationError,
        Superserve::NotFoundError,
        Superserve::ConflictError,
        Superserve::RateLimitError,
        Superserve::ServerError,
        Superserve::TimeoutError,
        Superserve::BuildError
      ].each do |klass|
        expect(klass.ancestors).to include(Superserve::SandboxError)
      end
    end

    it "SandboxError carries status_code, code, message" do
      err = Superserve::SandboxError.new("boom", status_code: 500, code: "x")
      expect(err.message).to eq("boom")
      expect(err.status_code).to eq(500)
      expect(err.code).to eq("x")
    end

    it "BuildError carries build_id, template_id, code" do
      err = Superserve::BuildError.new("fail", code: "step_failed", build_id: "b1", template_id: "t1")
      expect(err.code).to eq("step_failed")
      expect(err.build_id).to eq("b1")
      expect(err.template_id).to eq("t1")
    end
  end

  describe ".map_api_error" do
    it "maps 400 to ValidationError" do
      err = Superserve.map_api_error(400, { "error" => { "message" => "bad" } })
      expect(err).to be_a(Superserve::ValidationError)
      expect(err.message).to eq("bad")
    end

    it "maps 401 and 403 to AuthenticationError" do
      [401, 403].each do |status|
        err = Superserve.map_api_error(status, {})
        expect(err).to be_a(Superserve::AuthenticationError)
        expect(err.status_code).to eq(status)
      end
    end

    it "maps 404 to NotFoundError" do
      err = Superserve.map_api_error(404, {})
      expect(err).to be_a(Superserve::NotFoundError)
    end

    it "maps 409 to ConflictError" do
      err = Superserve.map_api_error(409, {})
      expect(err).to be_a(Superserve::ConflictError)
    end

    it "maps 429 to RateLimitError preserving code" do
      err = Superserve.map_api_error(429, { "error" => { "code" => "too_many_sandboxes" } })
      expect(err).to be_a(Superserve::RateLimitError)
      expect(err.code).to eq("too_many_sandboxes")
    end

    it "maps 5xx to ServerError" do
      err = Superserve.map_api_error(500, {})
      expect(err).to be_a(Superserve::ServerError)
    end

    it "falls back to SandboxError for other statuses" do
      err = Superserve.map_api_error(418, {})
      expect(err).to be_a(Superserve::SandboxError)
      expect(err).not_to be_a(Superserve::ValidationError)
      expect(err.status_code).to eq(418)
    end

    it "uses default message when error.message is missing" do
      err = Superserve.map_api_error(400, {})
      expect(err.message).to include("400")
    end

    it "tolerates non-Hash bodies" do
      expect { Superserve.map_api_error(400, nil) }.not_to raise_error
      expect { Superserve.map_api_error(400, "garbage") }.not_to raise_error
    end
  end
end

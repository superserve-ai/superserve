RSpec.describe "Superserve type converters" do
  describe ".to_sandbox_info" do
    it "converts a complete API response" do
      raw = {
        "id" => "sb_1", "name" => "n", "status" => "active",
        "vcpu_count" => 4, "memory_mib" => 2048,
        "created_at" => "2026-01-01T00:00:00Z",
        "timeout_seconds" => 600,
        "network" => { "allow_out" => ["1.2.3.4/32"], "deny_out" => ["0.0.0.0/0"] },
        "metadata" => { "env" => "prod" }
      }
      info = Superserve.to_sandbox_info(raw)
      expect(info.id).to eq("sb_1")
      expect(info.status).to eq("active")
      expect(info.vcpu_count).to eq(4)
      expect(info.created_at).to be_a(Time)
      expect(info.timeout_seconds).to eq(600)
      expect(info.network.allow_out).to eq(["1.2.3.4/32"])
      expect(info.metadata).to eq({ "env" => "prod" })
    end

    it "raises on missing id" do
      expect {
        Superserve.to_sandbox_info("status" => "active", "created_at" => "2026-01-01T00:00:00Z")
      }.to raise_error(Superserve::SandboxError, /missing sandbox id/)
    end

    it "raises on missing status" do
      expect {
        Superserve.to_sandbox_info("id" => "sb_1", "created_at" => "2026-01-01T00:00:00Z")
      }.to raise_error(Superserve::SandboxError, /missing sandbox status/)
    end

    it "raises on missing created_at" do
      expect {
        Superserve.to_sandbox_info("id" => "sb_1", "status" => "active")
      }.to raise_error(Superserve::SandboxError, /missing created_at/)
    end

    it "fills defaults for optional fields" do
      info = Superserve.to_sandbox_info(
        "id" => "sb_1", "status" => "active", "created_at" => "2026-01-01T00:00:00Z"
      )
      expect(info.name).to eq("")
      expect(info.vcpu_count).to eq(0)
      expect(info.memory_mib).to eq(0)
      expect(info.network).to be_nil
      expect(info.metadata).to eq({})
    end
  end

  describe ".to_template_info" do
    it "preserves latest_build_id when explicitly passed" do
      raw = {
        "id" => "t1", "name" => "t", "team_id" => "team1", "status" => "ready",
        "created_at" => "2026-01-01T00:00:00Z"
      }
      info = Superserve.to_template_info(raw, "build_xyz")
      expect(info.latest_build_id).to eq("build_xyz")
    end
  end

  describe ".to_template_build_info" do
    it "rejects responses missing build_spec_hash" do
      expect {
        Superserve.to_template_build_info(
          "id" => "b1", "template_id" => "t1", "status" => "ready",
          "created_at" => "2026-01-01T00:00:00Z"
        )
      }.to raise_error(Superserve::SandboxError, /build_spec_hash/)
    end
  end

  describe ".parse_iso8601" do
    it "parses Z-suffixed UTC times" do
      t = Superserve.parse_iso8601("2026-01-01T12:34:56Z")
      expect(t).to be_a(Time)
      expect(t.utc.iso8601).to eq("2026-01-01T12:34:56Z")
    end

    it "returns nil for nil input" do
      expect(Superserve.parse_iso8601(nil)).to be_nil
    end
  end
end

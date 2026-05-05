RSpec.describe "Superserve.resolve_config" do
  it "resolves api_key from explicit arg" do
    cfg = Superserve.resolve_config(api_key: "explicit", base_url: "https://api.superserve.ai")
    expect(cfg.api_key).to eq("explicit")
    expect(cfg.base_url).to eq("https://api.superserve.ai")
  end

  it "falls back to SUPERSERVE_API_KEY env" do
    cfg = Superserve.resolve_config
    expect(cfg.api_key).to eq("ss_live_test_key")
  end

  it "raises AuthenticationError when no key is available" do
    ENV.delete("SUPERSERVE_API_KEY")
    expect { Superserve.resolve_config }.to raise_error(Superserve::AuthenticationError)
  end

  it "uses default base_url when none provided" do
    ENV.delete("SUPERSERVE_BASE_URL")
    cfg = Superserve.resolve_config(api_key: "x")
    expect(cfg.base_url).to eq("https://api.superserve.ai")
  end

  describe "sandbox_host derivation" do
    it "derives sandbox.superserve.ai from production base_url" do
      cfg = Superserve.resolve_config(api_key: "x", base_url: "https://api.superserve.ai")
      expect(cfg.sandbox_host).to eq("sandbox.superserve.ai")
    end

    it "derives sandbox-staging from staging base_url" do
      cfg = Superserve.resolve_config(api_key: "x", base_url: "https://api-staging.superserve.ai")
      expect(cfg.sandbox_host).to eq("sandbox-staging.superserve.ai")
    end

    it "uses safe default for any other URL" do
      cfg = Superserve.resolve_config(api_key: "x", base_url: "https://api.test.local")
      expect(cfg.sandbox_host).to eq("sandbox.superserve.ai")
    end
  end
end

RSpec.describe "Superserve.data_plane_url" do
  it "builds the boxd-prefixed URL" do
    expect(Superserve.data_plane_url("sb_xyz", "sandbox.superserve.ai"))
      .to eq("https://boxd-sb_xyz.sandbox.superserve.ai")
  end
end

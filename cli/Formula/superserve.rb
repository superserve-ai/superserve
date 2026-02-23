class Superserve < Formula
  desc "CLI for deploying AI agents to sandboxed cloud containers"
  homepage "https://superserve.ai"
  url "https://github.com/superserve-ai/superserve/archive/refs/tags/__TAG__.tar.gz"
  sha256 "__SHA256__"
  license "MIT"

  depends_on "bun" => :build

  def install
    cd "cli" do
      system "bun", "install", "--frozen-lockfile"
      system "bun", "build", "--compile", "--outfile", bin/"superserve", "src/index.ts"
    end
  end

  test do
    assert_match "superserve", shell_output("#{bin}/superserve --help")
  end
end

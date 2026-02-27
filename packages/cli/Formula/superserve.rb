class Superserve < Formula
  desc "CLI for deploying AI agents to sandboxed cloud containers"
  homepage "https://superserve.ai"
  version "__VERSION__"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/superserve-ai/superserve/releases/download/__TAG__/superserve-bun-darwin-arm64"
      sha256 "__SHA256_DARWIN_ARM64__"
    else
      url "https://github.com/superserve-ai/superserve/releases/download/__TAG__/superserve-bun-darwin-x64"
      sha256 "__SHA256_DARWIN_X64__"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/superserve-ai/superserve/releases/download/__TAG__/superserve-bun-linux-arm64"
      sha256 "__SHA256_LINUX_ARM64__"
    else
      url "https://github.com/superserve-ai/superserve/releases/download/__TAG__/superserve-bun-linux-x64"
      sha256 "__SHA256_LINUX_X64__"
    end
  end

  def install
    bin.install Dir.glob("superserve-*").first => "superserve"
  end

  test do
    assert_match "superserve", shell_output("#{bin}/superserve --help")
  end
end

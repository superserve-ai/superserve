RSpec.describe Superserve::Files do
  let(:files) { described_class.new("sb_1", "sandbox.test.local", "tok") }
  let(:base) { "https://boxd-sb_1.sandbox.test.local" }

  describe "path validation" do
    it "rejects paths not starting with /" do
      expect { files.write("relative", "x") }.to raise_error(Superserve::ValidationError, /must start with/)
      expect { files.read("relative") }.to raise_error(Superserve::ValidationError)
    end

    it "rejects paths containing .. segments" do
      expect { files.write("/a/../b", "x") }.to raise_error(Superserve::ValidationError, /must not contain/)
      expect { files.read("/../etc/passwd") }.to raise_error(Superserve::ValidationError)
    end

    it "accepts absolute paths" do
      stub_request(:post, "#{base}/files?path=%2Fapp%2Fdata.txt").to_return(status: 204)
      expect { files.write("/app/data.txt", "hello") }.not_to raise_error
    end
  end

  describe "#write" do
    it "POSTs to the data plane with X-Access-Token" do
      stub = stub_request(:post, "#{base}/files?path=%2Fa.txt")
        .with(headers: { "X-Access-Token" => "tok", "Content-Type" => "application/octet-stream" })
        .to_return(status: 204)
      files.write("/a.txt", "content")
      expect(stub).to have_been_requested
    end

    it "URL-encodes path with spaces and special chars" do
      stub = stub_request(:post, "#{base}/files?path=%2Fmy%20file.txt").to_return(status: 204)
      files.write("/my file.txt", "x")
      expect(stub).to have_been_requested
    end

    it "writes binary content as bytes" do
      bin = "\x00\x01\x02\xFF".b
      stub = stub_request(:post, "#{base}/files?path=%2Fbin").with(body: bin).to_return(status: 204)
      files.write("/bin", bin)
      expect(stub).to have_been_requested
    end
  end

  describe "#read" do
    it "GETs raw bytes" do
      stub_request(:get, "#{base}/files?path=%2Fr.txt").to_return(status: 200, body: "hello")
      expect(files.read("/r.txt")).to eq("hello")
    end
  end

  describe "#read_text" do
    it "decodes UTF-8 bytes to string" do
      stub_request(:get, "#{base}/files?path=%2Ft.txt").to_return(status: 200, body: "héllo")
      expect(files.read_text("/t.txt")).to eq("héllo")
    end
  end
end

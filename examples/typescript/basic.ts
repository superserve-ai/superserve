import { Superserve } from "@superserve/sdk";

const client = new Superserve({ apiKey: process.env.SUPERSERVE_API_KEY });

async function main() {
  // Create a VM
  const vm = await client.vms.create({ name: "example-sandbox" });
  console.log(`Created VM: ${vm.id}`);

  // Execute a command
  const result = await client.vms.exec(vm.id, {
    command: "uname -a && echo 'Hello from Superserve!'",
  });
  console.log(`stdout: ${result.stdout}`);

  // Upload a file
  await client.files.upload(vm.id, "./hello.txt", "/home/user/hello.txt");
  console.log("Uploaded hello.txt");

  // Verify the upload
  const cat = await client.vms.exec(vm.id, { command: "cat /home/user/hello.txt" });
  console.log(`File contents: ${cat.stdout}`);

  // Checkpoint the VM
  const checkpoint = await client.checkpoints.create(vm.id, {
    name: "after-setup",
  });
  console.log(`Checkpoint created: ${checkpoint.id}`);

  // Make a change after the checkpoint
  await client.vms.exec(vm.id, { command: "rm /home/user/hello.txt" });

  // Fork from the checkpoint (hello.txt still exists in the fork)
  const forked = await client.vms.fork(vm.id, {
    checkpointId: checkpoint.id,
    name: "forked-sandbox",
  });
  console.log(`Forked VM: ${forked.id}`);

  const verify = await client.vms.exec(forked.id, {
    command: "cat /home/user/hello.txt",
  });
  console.log(`File in forked VM: ${verify.stdout}`);

  // Clean up
  await client.vms.delete(forked.id);
  await client.vms.delete(vm.id);
  console.log("Cleaned up VMs");
}

main().catch(console.error);

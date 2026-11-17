// kubi.disconnect()
// Close the link. The same instance can connect again.
export default async function (kubi) {
  await kubi.disconnect();
  console.log(kubi.connectionState);   // "disconnected"
}

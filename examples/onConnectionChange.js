// kubi.onConnectionChange(callback)
// Be told when the connection state changes. Connect first, then run this: it disconnects.
export default async function (kubi) {
  const unsubscribe = kubi.onConnectionChange((change) => console.log(change));
  await kubi.disconnect();   // { state: "disconnected", cause: "byApp" }
  await new Promise((resolve) => setTimeout(resolve, 100));
  unsubscribe();
}

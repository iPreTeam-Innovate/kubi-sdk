// kubi.connectionState
// The current connection state: "disconnected", "connecting" or "connected".
export default async function (kubi) {
  console.log(kubi.connectionState);   // "connected"
}

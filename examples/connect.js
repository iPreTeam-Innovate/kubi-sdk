// kubi.connect()
// Open the browser's device chooser and connect to the Kubi the user picks.
// Call it from a click. If you are already connected, the result says so instead of throwing.
export default async function (kubi) {
  const result = await kubi.connect();
  console.log(result);   // { type: "connected" }
}

// kubi.onDiagnostic(callback)
// See what the library sends to the device. One goal write is one "write" event.
export default async function (kubi) {
  const unsubscribe = kubi.onDiagnostic((event) => {
    if (event.type === 'write') console.log(event.purpose, event.axis, event.bytes);
  });
  await kubi.writePanGoal(30);   // "goal" "pan" Uint8Array [2, 102]
  await new Promise((resolve) => setTimeout(resolve, 100));
  unsubscribe();
}

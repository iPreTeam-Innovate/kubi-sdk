// kubi.onServoFault(callback)
// Be told when the device reports a servo fault. Hold the neck while it is turning.
// On the device the error stays until the power is cycled.
export default async function (kubi) {
  const unsubscribe = kubi.onServoFault((error) => console.log(error.axis, error.overload));   // "pan" true
  await kubi.writePanGoal(90);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  unsubscribe();
}

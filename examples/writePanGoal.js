// kubi.writePanGoal(degrees)
// Write the angle the neck turns to (−150 to 150, positive is to the right), give it time, then read where it is.
// Stopping about 1° short of the goal is normal.
export default async function (kubi) {
  await kubi.writePanGoal(30);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const pan = await kubi.readPan();
  console.log(pan.value.toFixed(1));   // "29.2"
}

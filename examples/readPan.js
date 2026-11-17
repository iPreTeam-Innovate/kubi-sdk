// kubi.readPan()
// Read the present pan position: the angle, when it was measured, and how old the measurement is.
export default async function (kubi) {
  const pan = await kubi.readPan();
  console.log(pan.value.toFixed(1));   // "29.2"
  console.log(pan.observedAt);         // a Date: when it was measured
  console.log(pan.ageMs);              // 0, and grows as time passes
}

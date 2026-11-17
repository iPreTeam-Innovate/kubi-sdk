// kubi.onButtonChange(callback)
// Be told when the button on the device is pressed and released. Press it within 10 seconds.
export default async function (kubi) {
  const unsubscribe = kubi.onButtonChange((pressed) => console.log(pressed));   // true, then false
  await new Promise((resolve) => setTimeout(resolve, 10000));
  unsubscribe();
}

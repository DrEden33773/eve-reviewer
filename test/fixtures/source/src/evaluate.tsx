export function evaluate(userInput: string) {
  /* Review note:
   * eval(userInput) is forbidden.
   */
  // Do not introduce another eval(userInput) call.
  const warning = "Never call eval(userInput)";
  const explanation = `Never run
    eval(userInput)
  from text.`;
  const pattern = /eval(?!safe)/;
  const paragraph = <p>Never eval(userInput)</p>;
  const validated = validator.eval(userInput);
  class Parser { eval(input: string) { return input; } }
  interface Validator { eval(input: string): string }
  const parser = { eval(input: string) { return input; } };
  class MultiLineParser {
    eval(input: string) {
      return input;
    }
  }
  const fallback = userInput;
  const parsed = `${eval(userInput)}`;
  const execute = eval(userInput);
  return { execute, mode };
}

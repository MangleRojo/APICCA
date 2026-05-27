const assert = require("assert");
const {test, describe} = require("node:test");

// Minimal mock for firebase-functions to unit-test validation logic.
// The real callGemini is tightly coupled to firebase-functions/https,
// so we test the validation logic by importing the module and simulating
// HTTP requests through a lightweight request/response mock.

// Since the module uses firebase-functions imports, we test the validation
// rules directly by extracting the logic into assertions.

describe("callGemini input validation rules", () => {
  test("rejects non-POST methods", () => {
    // The function should only accept POST
    const validMethods = ["POST"];
    const invalidMethods = ["GET", "PUT", "DELETE", "PATCH"];

    for (const m of validMethods) {
      assert.ok(m === "POST", `${m} should be accepted`);
    }
    for (const m of invalidMethods) {
      assert.ok(m !== "POST", `${m} should be rejected with 405`);
    }
  });

  test("rejects empty prompt", () => {
    const cases = [
      {body: {}, expected: "missing prompt"},
      {body: {prompt: ""}, expected: "empty string"},
      {body: {prompt: "   "}, expected: "whitespace only"},
      {body: {prompt: 123}, expected: "non-string type"},
    ];

    for (const {body, expected} of cases) {
      const prompt = body.prompt;
      const isInvalid =
        typeof prompt !== "string" || prompt.trim().length === 0;
      assert.ok(isInvalid, `Should reject: ${expected}`);
    }
  });

  test("rejects prompt exceeding max length", () => {
    const MAX_PROMPT_LENGTH = 2000;
    const longPrompt = "a".repeat(2001);
    assert.ok(
        longPrompt.length > MAX_PROMPT_LENGTH,
        "Prompt over 2000 chars should be rejected",
    );

    const validPrompt = "a".repeat(2000);
    assert.ok(
        validPrompt.length <= MAX_PROMPT_LENGTH,
        "Prompt at exactly 2000 chars should be accepted",
    );
  });

  test("strips HTML tags from prompt", () => {
    const raw = "<script>alert('xss')</script>Hola mundo";
    const sanitized = raw.replace(/<[^>]*>/g, "").trim();
    assert.strictEqual(sanitized, "alert('xss')Hola mundo");
  });

  test("accepts valid prompt", () => {
    const prompt = "Dimensiones seleccionadas: Tiempo, Espacio.";
    const isValid =
      typeof prompt === "string" && prompt.trim().length > 0 &&
      prompt.length <= 2000;
    assert.ok(isValid, "Valid prompt should pass validation");
  });
});

export const DECISIONS = {
  questionnaire: "sliderule-questionnaire",
  plan: "sliderule-plan-approval",
};

export async function visibleDecision(page) {
  for (const [kind, testId] of Object.entries(DECISIONS)) {
    if (await page.getByTestId(testId).isVisible()) return kind;
  }
  return null;
}

export async function measureDecision(page, kind) {
  return page.evaluate(testId => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) return { present: false };
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const top = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 20)
    );
    return {
      present: true,
      painted:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0,
      inViewport:
        rect.top >= 0 &&
        rect.bottom <= innerHeight &&
        rect.width > 0 &&
        rect.height > 0,
      covered: !top || !el.contains(top),
      content:
        el
          .querySelector(
            '[data-testid="sliderule-plan-content"], [data-testid="sliderule-questionnaire-question"]'
          )
          ?.textContent?.trim() || "",
      pager:
        el
          .querySelector('[data-testid="sliderule-questionnaire-pager"]')
          ?.textContent?.trim() || "",
    };
  }, DECISIONS[kind]);
}

async function submitDecision(page, card, button, kind, timeout) {
  const previous = await card.elementHandle();
  const responsePromise = page
    .waitForResponse(
      response => {
        if (
          !response.url().includes("/control-turn-stream") ||
          response.request().method() !== "POST"
        )
          return false;
        try {
          const answer = response.request().postDataJSON()?.toolAnswer;
          return (
            answer?.kind === kind &&
            Boolean(answer.reqId) &&
            answer.outcome ===
              (kind === "plan_approval" ? "approved" : "accepted")
          );
        } catch {
          return false;
        }
      },
      { timeout }
    )
    .catch(error => error);
  await button.click({ timeout });
  const response = await responsePromise;
  if (response instanceof Error) throw response;
  if (!response.ok())
    throw new Error(`${kind} returned HTTP ${response.status()}`);
  // Wait on the old element: the next request may immediately mount the same test id.
  await previous?.waitForElementState("hidden", { timeout });
  await previous?.dispose();
  return response.request().postDataJSON().toolAnswer;
}

export async function answerQuestionnaire(
  page,
  { otherAnswer = "", onQuestion = async () => {}, timeout = 60000 } = {}
) {
  const card = page.getByTestId(DECISIONS.questionnaire);
  for (let step = 0; step < 32; step += 1) {
    const question = await card
      .getByTestId("sliderule-questionnaire-question")
      .innerText();
    const recommended = card.locator(
      '[data-testid="sliderule-questionnaire-option"][data-recommended="true"]'
    );
    const regular = card.locator(
      '[data-testid="sliderule-questionnaire-option"][data-other="false"]'
    );
    const useOther = Boolean(otherAnswer) || !(await regular.count());
    const choice = useOther
      ? card.locator(
          '[data-testid="sliderule-questionnaire-option"][data-other="true"]'
        )
      : (await recommended.count())
        ? recommended.first()
        : regular.first();
    await choice.click();
    if (useOther) {
      if (!otherAnswer)
        throw new Error(
          "Question has no options; set E2E_CLARIFY_ANSWER for a written answer"
        );
      await card
        .getByTestId("sliderule-questionnaire-other-input")
        .fill(otherAnswer);
    }
    await onQuestion({
      step: step + 1,
      question,
      answer: useOther ? otherAnswer : await choice.innerText(),
    });
    const next = card.getByTestId("sliderule-questionnaire-next");
    if (await next.isVisible()) {
      const pager = await card
        .getByTestId("sliderule-questionnaire-pager")
        .innerText();
      await next.click();
      await page.waitForFunction(
        previousPager =>
          document
            .querySelector('[data-testid="sliderule-questionnaire-pager"]')
            ?.textContent?.trim() !== previousPager.trim(),
        pager,
        { timeout }
      );
      continue;
    }
    return submitDecision(
      page,
      card,
      card.getByTestId("sliderule-questionnaire-submit"),
      "ask_user",
      timeout
    );
  }
  throw new Error("Questionnaire exceeded 32 pages");
}

export async function approvePlan(page, { timeout = 60000 } = {}) {
  const card = page.getByTestId(DECISIONS.plan);
  const content = (
    await card.getByTestId("sliderule-plan-content").innerText()
  ).trim();
  if (!content) throw new Error("Cannot approve an empty plan");
  const answer = await submitDecision(
    page,
    card,
    card.getByRole("button", { name: "批准并执行", exact: true }),
    "plan_approval",
    timeout
  );
  return { content, answer };
}

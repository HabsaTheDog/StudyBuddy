## Inspiration

Study Buddy started with a frustration I kept running into at university: before I could study, I first had to find out where everything was. Course material was in Moodle, dates were somewhere else, and useful context was scattered across files, calendars, and student portals.

AI agents saved me hours, but only because I had slowly learned how to give them context and check their work. I started showing friends how I did it. That helped, but it did not scale. If someone needs a personal tutorial before an agent becomes useful, the workflow is not really accessible.

My first attempt was a small Moodle scraper. It grew into Study Buddy 1.0, a set of skills I knew how to supervise. Complete study documents exposed the real challenge: finding a page is easy; knowing whether it is the right source and actually useful is much harder.

## What it does

Study Buddy is a local, open-source AI learning companion. With the student's authorization, it searches Moodle and CIS and turns course material into PDF or offline interactive study guides. It reports gaps instead of hiding them behind a confident answer. It can help with quizzes and assignments, but it never submits a final Moodle quiz attempt.

## How I built it

Study Buddy combines a modified T3 Code interface with a TypeScript and LangGraph runtime. Each run saves its evidence and state so failed jobs can resume. It creates Typst PDFs and self-contained offline webpages.

I built the project with Codex as my main engineering collaborator, but not with only one model. Earlier versions used GPT-5.5 and other available models. During Build Week, most of my recorded Codex work used GPT-5.6, which I also integrated into the product's workflows.

Study Buddy predates the hackathon; the conservative baseline is commit `fe3a6fe`. Build Week added the deeper T3 integration, safer student workflows, source-grounded artifacts, quality review, and resumable extraction.

## Challenges I ran into

The hardest part was turning human judgment into product behavior. A student may instinctively know where an exam date belongs, or that a polished document can still be terrible to learn from. I had to encode those instincts through source rules, validation, and recovery.

## Accomplishments that I'm proud of

I am proud that a tool I built for myself has become a real student-facing product.

- It turns authenticated university sources into source-grounded study guides.
- It admits when coverage is incomplete.
- It helps with quizzes while blocking final submission.

Most of all, the advice I used to repeat to friends—give the agent the right context, check the source, and question confident answers—is becoming part of the product itself.

## What I learned

I learned that an education agent is not just a chatbot connected to Moodle. Generating text is easy. The real work is choosing the right evidence, admitting when something is missing, and creating something a student can genuinely learn from.

I also learned that the best results with Codex came from treating it as a collaborator: inspect the evidence, make a decision, implement it, and test the result for real.

## What's next for Study Buddy

Next I want to add a synthetic demo portal so anyone can try Study Buddy without a real university account.

Long term, I want it to remain free and open source. Students should benefit from powerful agent workflows without first becoming experts in prompting or navigating a maze of university portals.

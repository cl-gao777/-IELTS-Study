import ui from "@/components/page-ui.module.css";
import {
  listAttempts,
  listMockExams,
  listWritingSubmissions,
} from "@/server/store";

export const dynamic = "force-dynamic";

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export default function AnalyticsPage() {
  const attempts = listAttempts(30);
  const writing = listWritingSubmissions(20);
  const mocks = listMockExams(10);
  const reading = attempts.filter((attempt) => attempt.kind === "reading");
  const listening = attempts.filter((attempt) => attempt.kind === "listening");

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Learning signals</p>
          <h1>Progress analytics</h1>
          <p>
            只根据你在 ISTS 中提交的练习计算。数据少时显示基线，而不是制造虚假的精确度。
          </p>
        </div>
      </header>

      <section className={ui.grid3}>
        <div className={ui.metric}>
          <small>Listening average</small>
          <strong>
            {listening.length
              ? average(listening.map((item) => item.bandScore)).toFixed(1)
              : "—"}
          </strong>
          <span>{listening.length} submitted attempts</span>
        </div>
        <div className={ui.metric}>
          <small>Reading average</small>
          <strong>
            {reading.length
              ? average(reading.map((item) => item.bandScore)).toFixed(1)
              : "—"}
          </strong>
          <span>{reading.length} submitted attempts</span>
        </div>
        <div className={ui.metric}>
          <small>Writing average</small>
          <strong>
            {writing.length
              ? average(writing.map((item) => item.overallBand)).toFixed(1)
              : "—"}
          </strong>
          <span>{writing.length} evaluated drafts</span>
        </div>
      </section>

      <br />
      <div className={ui.grid2}>
        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Objective practice</p>
              <h2>Recent attempts</h2>
            </div>
          </div>
          {attempts.length ? (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Raw</th>
                  <th>Band</th>
                  <th>Duration</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{attempt.kind}</td>
                    <td>
                      {attempt.rawScore}/{attempt.totalQuestions}
                    </td>
                    <td>{attempt.bandScore.toFixed(1)}</td>
                    <td>{Math.round(attempt.durationSeconds / 60)} min</td>
                    <td>
                      {new Date(attempt.submittedAt).toLocaleDateString(
                        "zh-CN",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={ui.empty}>No submitted practice yet.</div>
          )}
        </section>

        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Full simulations</p>
              <h2>Mock history</h2>
            </div>
          </div>
          {mocks.length ? (
            <div className={ui.list}>
              {mocks.map((mock) => (
                <div className={ui.listItem} key={mock.id}>
                  <strong>
                    Mock #{mock.id} · Estimated{" "}
                    {Number(mock.overall_band).toFixed(1)}
                  </strong>
                  <small>
                    {new Date(mock.submitted_at).toLocaleString("zh-CN")}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <div className={ui.empty}>
              Complete the full computer mock to create a report.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


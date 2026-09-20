import {serviceIntroduction as copy} from '../content/service-introduction';

export default function ServiceIntroduction() {
  return (
    <div className="nuanox-introduction">
      <p className="nuanox-introduction-lead">{copy.intro}</p>
      {copy.sections.map((section) => (
        <section className="nuanox-introduction-section" key={section.heading}>
          <h3>{section.heading}</h3>
          <p>{section.body}</p>
        </section>
      ))}
      <section className="nuanox-introduction-section">
        <h3>{copy.usageHeading}</h3>
        <p>{copy.usage}</p>
      </section>
      <p className="nuanox-introduction-note">{copy.note}</p>
    </div>
  );
}

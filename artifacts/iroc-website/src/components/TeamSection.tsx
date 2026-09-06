import { useListTeamMembers } from '@workspace/api-client-react';
import { useLanguage } from '@/contexts/LanguageContext';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

function photoUrl(path: string | null | undefined) {
  if (!path) return null;
  // External URLs (entered in the admin) are used as-is; /objects/... paths go through the storage proxy
  if (/^https?:\/\//.test(path)) return path;
  return `${BASE_URL}/api/storage${path}`;
}

type Category = 'consulting_doctors' | 'specialists' | 'ai_agents';

const CATEGORY_LABELS: Record<Category, { de: string; en: string }> = {
  consulting_doctors: { de: 'Beratende Mediziner',      en: 'Consulting Medical Doctors' },
  specialists:        { de: 'Spezialisten',              en: 'Specialists' },
  ai_agents:          { de: 'Agents/Managers',            en: 'Agents/Managers' },
};

const ADVISORY_CATEGORIES: Category[] = ['consulting_doctors', 'specialists'];

const SECTION_COPY = {
  teamTitle: {
    de: 'Das iROC Team',
    en: 'The iROC Team',
  },
  advisory: {
    de: 'Unabhängiges Beratungsnetzwerk',
    en: 'Independent Advisory Network',
    descriptionDe:
      'Ein kollaborativer Kreis externer Ärztinnen, Ärzte und Wissenschaftler:innen, die uns als unabhängige Berater begleiten und unsere innovative, regenerative medizinisch orientierte Beratung mitgestalten.',
    descriptionEn:
      'A collaborative circle of external physicians and scientists partnering with us as independent advisors to shape our innovative, regenerative medical-oriented consultation.',
  },
  ai: {
    de: 'Agents/Managers',
    en: 'Agents/Managers',
    descriptionDe:
      'Unsere digitalen Co-Piloten und Unterstützungssysteme für die tägliche Koordination, Vertriebsabläufe und den Kundenservice.',
    descriptionEn:
      'Our digital co-pilots and support systems driving day-to-day coordination, sales operations, and customer service.',
  },
} as const;

// Explicit CSS keeps the responsive card widths stable and centers every flex
// row independently, including incomplete final rows.
const MEMBER_GRID_CLASS = 'team-member-grid';
const MEMBER_CARD_CLASS = 'team-member-card flex flex-col items-center p-6';

export default function TeamSection() {
  const { t } = useLanguage();
  const { data: members = [] } = useListTeamMembers({
    query: { queryKey: ['team-members-public'], staleTime: 60_000 },
  });

  if (members.length === 0) return null;

  // Group members by category, preserving sort order within each group
  const groups = ADVISORY_CATEGORIES.map((cat) => ({
    cat,
    label: t(CATEGORY_LABELS[cat].de, CATEGORY_LABELS[cat].en),
    items: members.filter((m) => (m.category ?? 'consulting_doctors') === cat),
  })).filter((g) => g.items.length > 0);
  const aiAgents = members.filter((member) => member.category === 'ai_agents');

  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t(SECTION_COPY.teamTitle.de, SECTION_COPY.teamTitle.en)}
          </h2>
          <div className="w-24 h-1 bg-primary mx-auto" />
        </div>

        <div className="space-y-20">
          <div>
            <div className="text-center max-w-3xl mx-auto mb-12">
              <h3 className="text-2xl md:text-3xl font-bold text-primary">
                {t(SECTION_COPY.advisory.de, SECTION_COPY.advisory.en)}
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                {t(SECTION_COPY.advisory.descriptionDe, SECTION_COPY.advisory.descriptionEn)}
              </p>
            </div>

            <div className="space-y-16">
              {groups.map(({ cat, label, items }) => (
                <div key={cat}>
                  {/* Group heading */}
                  <div className="flex items-center gap-4 mb-10">
                    <div className="h-px flex-1 bg-border" />
                    <h4 className="text-lg font-semibold text-primary tracking-wide whitespace-nowrap">
                      {label}
                    </h4>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  {/* Members grid */}
                  <div className={MEMBER_GRID_CLASS}>
                    {items.map((member) => {
                      const photo = photoUrl(member.photoPath);
                      const role  = t(member.roleDe || member.role, member.role);
                      const bio   = t(member.bioDe || member.bio || '', member.bio || '');

                      return (
                        <div key={member.id} className={MEMBER_CARD_CLASS}>
                          {/* Avatar */}
                          <div className="w-36 h-36 mx-auto mb-6 rounded-full border-4 border-white shadow-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                            {photo ? (
                              <img
                                src={photo}
                                alt={member.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-5xl font-bold text-primary/20">
                                {member.name.charAt(0)}
                              </span>
                            )}
                          </div>

                          <h3 className="text-xl font-bold mb-1">{member.name}</h3>
                          <p className="text-sm text-primary font-medium mb-2">{role}</p>
                          {bio && (
                            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{bio}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {aiAgents.length > 0 && (
            <div>
              <div className="text-center max-w-3xl mx-auto mb-12">
                <h3 className="text-2xl md:text-3xl font-bold text-primary">
                  {t(SECTION_COPY.ai.de, SECTION_COPY.ai.en)}
                </h3>
                <p className="mt-4 text-muted-foreground leading-relaxed">
                  {t(SECTION_COPY.ai.descriptionDe, SECTION_COPY.ai.descriptionEn)}
                </p>
              </div>
              <div className={MEMBER_GRID_CLASS}>
                {aiAgents.map((member) => {
                  const photo = photoUrl(member.photoPath);
                  const role = t(member.roleDe || member.role, member.role);
                  const bio = t(member.bioDe || member.bio || '', member.bio || '');

                  return (
                    <div key={member.id} className={MEMBER_CARD_CLASS}>
                      <div className="w-36 h-36 mx-auto mb-6 rounded-full border-4 border-white shadow-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                        {photo ? (
                          <img src={photo} alt={member.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-5xl font-bold text-primary/20">{member.name.charAt(0)}</span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold mb-1">{member.name}</h3>
                      <p className="text-sm text-primary font-medium mb-2">{role}</p>
                      {bio && <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{bio}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

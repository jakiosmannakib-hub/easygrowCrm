/**
 * PUL-501.3 — the three demo templates, transcribed from the prototype's `tpls` array
 * (`docs/easygrowcrm-prototype.html`). `tpls` is the source; the file's older flat `templates`
 * array is NOT (it is the pre-Amendment-J shape).
 *
 * The data below keeps the PROTOTYPE's field names (`pri`, `est`, `ruleKind`, `qcGate`, …) so it
 * can be diffed line-for-line against `tpls`. `seedTemplates` maps it onto the §11.4 schema:
 *
 *   - ids: `seed_tpl_<slug>`, `seed_tm_<slug>_<num>`, `seed_tcat_<cat id>`, `seed_tt_<task id>`,
 *     `seed_tts_<subtask id>`. The prototype's own task id rides in the suffix so an `after`
 *     rule's `ruleRef: 'ttN'` maps to `due_rule.ref = 'seed_tt_ttN'`.
 *   - `position` is 1-based, in array order at every level.
 *   - `pri` is lowercased onto `task_priority`. One task (`tt23`) is `Urgent` in the prototype,
 *     which maps to the enum's `urgent`.
 *   - `ruleKind` 'before' → `before_deadline` (§11.4's name); 'day' / 'after' keep theirs.
 *   - No prototype month carries a start month/day, so every month gets `start_month = 0`,
 *     `start_day = 1`. `client_visible = false`, `sop_url` / `expected_output` null.
 *
 * Not seeded by seedMinimal: templates are a seedFull concern.
 */

import { db } from '../db';
import {
  templateCategories,
  templateMonths,
  templates,
  templateTasks,
  templateTaskSubtasks,
  type DueRule,
} from '../db/schema';

interface ProtoTask {
  id: string;
  title: string;
  role: string;
  pri: 'Low' | 'Medium' | 'High' | 'Urgent';
  est: number;
  ruleKind: 'day' | 'after' | 'before';
  ruleVal: number | null;
  ruleRef: string | null;
  checklist: string[];
  proofReq: boolean;
  qcGate: boolean;
  subtasks?: { id: string; title: string }[];
}

interface ProtoTemplate {
  slug: string;
  name: string;
  cat: string;
  desc: string;
  roles: string[];
  months: { num: number; name: string; cats: { id: string; name: string; tasks: ProtoTask[] }[] }[];
}

const TPLS: ProtoTemplate[] = [
  {
    slug: 'local_seo_monthly_campaign',
    name: 'Local SEO Monthly Campaign',
    cat: 'SEO',
    desc: 'The full monthly deliverable cycle for a local SEO retainer: GBP work, citations, content, rank tracking and the client report.',
    roles: ['Project Manager', 'SEO Executive', 'Content Writer', 'QC'],
    months: [
      {
        num: 1,
        name: 'Month 1',
        cats: [
          {
            id: 'c1a',
            name: 'On-page SEO',
            tasks: [
              {
                id: 'tt1',
                title: 'GBP — post 4 updates',
                role: 'SEO Executive',
                pri: 'Medium',
                est: 2,
                ruleKind: 'day',
                ruleVal: 3,
                ruleRef: null,
                checklist: ['Draft posts', 'Schedule in GBP'],
                proofReq: true,
                qcGate: true,
                subtasks: [
                  { id: 'st1a', title: 'Research post topics' },
                  { id: 'st1b', title: 'Write captions' },
                  { id: 'st1c', title: 'Design post images' },
                ],
              },
              {
                id: 'tt2',
                title: 'Audit + fix NAP inconsistencies',
                role: 'SEO Executive',
                pri: 'High',
                est: 3,
                ruleKind: 'day',
                ruleVal: 5,
                ruleRef: null,
                checklist: ['Run citation audit', 'Fix ≥10 issues'],
                proofReq: true,
                qcGate: true,
                subtasks: [
                  { id: 'st2a', title: 'Run Screaming Frog crawl' },
                  { id: 'st2b', title: 'Cross-check with BrightLocal' },
                ],
              },
            ],
          },
          {
            id: 'c1b',
            name: 'Link Building',
            tasks: [
              {
                id: 'tt3',
                title: 'Build 8 new citations',
                role: 'SEO Executive',
                pri: 'Medium',
                est: 4,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt2',
                checklist: ['Submit citations', 'Screenshot proof'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt12',
                title: '1 niche edit on DR50+ site',
                role: 'SEO Executive',
                pri: 'High',
                est: 3,
                ruleKind: 'day',
                ruleVal: 12,
                ruleRef: null,
                checklist: ['Prospect approved', 'Anchor text set'],
                proofReq: true,
                qcGate: false,
              },
            ],
          },
          {
            id: 'c1c',
            name: 'Content',
            tasks: [
              {
                id: 'tt4',
                title: 'Service page copy — {{ClientName}}',
                role: 'Content Writer',
                pri: 'High',
                est: 5,
                ruleKind: 'day',
                ruleVal: 7,
                ruleRef: null,
                checklist: ['Keyword map applied', 'Internal links'],
                proofReq: true,
                qcGate: true,
                subtasks: [
                  { id: 'st4a', title: 'Draft outline' },
                  { id: 'st4b', title: 'Write first draft' },
                  { id: 'st4c', title: 'Self-edit pass' },
                  { id: 'st4d', title: 'Add internal links' },
                ],
              },
            ],
          },
          {
            id: 'c1d',
            name: 'Reporting',
            tasks: [
              {
                id: 'tt5',
                title: 'Rank check — week 1',
                role: 'SEO Executive',
                pri: 'Low',
                est: 1,
                ruleKind: 'day',
                ruleVal: 7,
                ruleRef: null,
                checklist: ['Export from tool', 'Highlight movements'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt6',
                title: 'Rank check — week 2',
                role: 'SEO Executive',
                pri: 'Low',
                est: 1,
                ruleKind: 'day',
                ruleVal: 14,
                ruleRef: null,
                checklist: ['Export from tool'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt7',
                title: 'Rank check — week 3',
                role: 'SEO Executive',
                pri: 'Low',
                est: 1,
                ruleKind: 'day',
                ruleVal: 21,
                ruleRef: null,
                checklist: ['Export from tool'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt8',
                title: 'Rank check — week 4',
                role: 'SEO Executive',
                pri: 'Low',
                est: 1,
                ruleKind: 'day',
                ruleVal: 28,
                ruleRef: null,
                checklist: ['Export from tool'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt9',
                title: 'Monthly report — {{ClientName}}',
                role: 'Project Manager',
                pri: 'High',
                est: 3,
                ruleKind: 'before',
                ruleVal: 2,
                ruleRef: null,
                checklist: [
                  'Include rank movements',
                  'Include citation count',
                  'Client-ready formatting',
                ],
                proofReq: true,
                qcGate: true,
              },
              {
                id: 'tt10',
                title: 'QC sign-off — all deliverables',
                role: 'QC',
                pri: 'High',
                est: 1,
                ruleKind: 'before',
                ruleVal: 1,
                ruleRef: null,
                checklist: ['All proofs attached', 'No open revisions'],
                proofReq: false,
                qcGate: true,
              },
            ],
          },
        ],
      },
      {
        num: 2,
        name: 'Month 2',
        cats: [
          {
            id: 'c2a',
            name: 'On-page SEO',
            tasks: [
              {
                id: 'tt13',
                title: 'GBP — post 4 updates',
                role: 'SEO Executive',
                pri: 'Medium',
                est: 2,
                ruleKind: 'day',
                ruleVal: 3,
                ruleRef: null,
                checklist: ['Draft posts', 'Schedule in GBP'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt14',
                title: 'Schema markup implementation',
                role: 'SEO Executive',
                pri: 'High',
                est: 4,
                ruleKind: 'day',
                ruleVal: 8,
                ruleRef: null,
                checklist: ['LocalBusiness schema', 'FAQPage schema'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
          {
            id: 'c2b',
            name: 'Reporting',
            tasks: [
              {
                id: 'tt15',
                title: 'Rank check — week 1',
                role: 'SEO Executive',
                pri: 'Low',
                est: 1,
                ruleKind: 'day',
                ruleVal: 7,
                ruleRef: null,
                checklist: ['Export from tool'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt16',
                title: 'Monthly report — {{ClientName}}',
                role: 'Project Manager',
                pri: 'High',
                est: 3,
                ruleKind: 'before',
                ruleVal: 2,
                ruleRef: null,
                checklist: ['Month-over-month comparison', 'Client-ready formatting'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'website_design_project',
    name: 'Website Design Project',
    cat: 'Website Design',
    desc: 'End-to-end site build: requirements, wireframes, copy, design, development and pre-launch QA — with dependencies enforced between stages.',
    roles: ['Project Manager', 'Content Writer', 'Web Designer', 'Developer', 'QC'],
    months: [
      {
        num: 1,
        name: 'Phase 1 — Discovery',
        cats: [
          {
            id: 'c3a',
            name: 'Design',
            tasks: [
              {
                id: 'tt17',
                title: 'Requirements doc — {{ClientName}}',
                role: 'Project Manager',
                pri: 'High',
                est: 3,
                ruleKind: 'day',
                ruleVal: 1,
                ruleRef: null,
                checklist: ['Goals agreed', 'Pages listed', 'Brand assets received'],
                proofReq: true,
                qcGate: false,
                subtasks: [
                  { id: 'st17a', title: 'Client discovery call' },
                  { id: 'st17b', title: 'Fill brief template' },
                  { id: 'st17c', title: 'Get sign-off' },
                ],
              },
              {
                id: 'tt18',
                title: 'Wireframes — all pages',
                role: 'Web Designer',
                pri: 'High',
                est: 8,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt17',
                checklist: ['Mobile + desktop', 'Client approval'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
          {
            id: 'c3b',
            name: 'Content',
            tasks: [
              {
                id: 'tt19',
                title: 'Copy — all pages',
                role: 'Content Writer',
                pri: 'High',
                est: 10,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt17',
                checklist: ['SEO keywords mapped', 'Tone match signed off'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
        ],
      },
      {
        num: 2,
        name: 'Phase 2 — Build',
        cats: [
          {
            id: 'c4a',
            name: 'Design',
            tasks: [
              {
                id: 'tt20',
                title: 'Design — all pages',
                role: 'Web Designer',
                pri: 'High',
                est: 16,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt18',
                checklist: ['Desktop complete', 'Mobile complete'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
          {
            id: 'c4b',
            name: 'Technical',
            tasks: [
              {
                id: 'tt21',
                title: 'Development build — staging',
                role: 'Developer',
                pri: 'High',
                est: 24,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt20',
                checklist: ['All pages coded', 'Forms working', 'Speed score ≥85'],
                proofReq: true,
                qcGate: true,
              },
              {
                id: 'tt22',
                title: 'Pre-launch QA',
                role: 'QC',
                pri: 'High',
                est: 4,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt21',
                checklist: ['Cross-browser checked', 'Mobile tested', 'No broken links'],
                proofReq: true,
                qcGate: true,
              },
              {
                id: 'tt23',
                title: 'Go live + DNS cutover',
                role: 'Developer',
                pri: 'Urgent',
                est: 2,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt22',
                checklist: ['DNS updated', 'SSL verified', 'Redirects confirmed'],
                proofReq: true,
                qcGate: false,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'technical_seo_audit',
    name: 'Technical SEO Audit',
    cat: 'SEO',
    desc: 'A one-off deep technical audit with a prioritised fix roadmap, delivered as a client-ready document.',
    roles: ['SEO Executive', 'Project Manager', 'QC'],
    months: [
      {
        num: 1,
        name: 'Audit Phase',
        cats: [
          {
            id: 'c5a',
            name: 'Technical',
            tasks: [
              {
                id: 'tt24',
                title: 'Crawl & indexation audit',
                role: 'SEO Executive',
                pri: 'High',
                est: 5,
                ruleKind: 'day',
                ruleVal: 2,
                ruleRef: null,
                checklist: ['Screaming Frog run', 'GSC data pulled'],
                proofReq: true,
                qcGate: false,
              },
              {
                id: 'tt25',
                title: 'Core Web Vitals & speed',
                role: 'SEO Executive',
                pri: 'High',
                est: 3,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt24',
                checklist: ['PageSpeed Insights', 'LCP/CLS logged'],
                proofReq: true,
                qcGate: false,
              },
            ],
          },
          {
            id: 'c5b',
            name: 'Reporting',
            tasks: [
              {
                id: 'tt26',
                title: 'Fix roadmap — prioritised',
                role: 'Project Manager',
                pri: 'High',
                est: 4,
                ruleKind: 'after',
                ruleVal: null,
                ruleRef: 'tt25',
                checklist: ['P1/P2/P3 labelled', 'Estimated dev hours'],
                proofReq: true,
                qcGate: true,
              },
              {
                id: 'tt27',
                title: 'Client-ready audit report',
                role: 'QC',
                pri: 'High',
                est: 3,
                ruleKind: 'before',
                ruleVal: 2,
                ruleRef: null,
                checklist: ['Executive summary', 'Formatted in brand template'],
                proofReq: true,
                qcGate: true,
              },
            ],
          },
        ],
      },
    ],
  },
];

export interface SeededTemplates {
  localSeo: string;
  websiteDesign: string;
  technicalSeoAudit: string;
}

/** `ruleKind` / `ruleVal` / `ruleRef` → the §11.4 `due_rule` shape. */
function dueRule(task: ProtoTask): DueRule {
  switch (task.ruleKind) {
    case 'day':
      return { kind: 'day', n: task.ruleVal ?? 0 };
    case 'before':
      return { kind: 'before_deadline', n: task.ruleVal ?? 0 };
    case 'after':
      return { kind: 'after', ref: `seed_tt_${task.ruleRef ?? ''}` };
  }
}

/**
 * Insert the three templates, walking Template → Month → Category → Task → Subtask so every
 * insert's parent already exists. `createdBy` is the seed PM.
 */
export async function seedTemplates(createdBy: string): Promise<SeededTemplates> {
  for (const tpl of TPLS) {
    const templateId = `seed_tpl_${tpl.slug}`;
    await db.insert(templates).values({
      id: templateId,
      name: tpl.name,
      description: tpl.desc,
      category: tpl.cat,
      roles: tpl.roles,
      createdBy,
    });

    for (const [mi, month] of tpl.months.entries()) {
      const monthId = `seed_tm_${tpl.slug}_${month.num}`;
      await db.insert(templateMonths).values({
        id: monthId,
        templateId,
        num: month.num,
        name: month.name,
        startMonth: 0,
        startDay: 1,
        position: mi + 1,
      });

      for (const [ci, cat] of month.cats.entries()) {
        const categoryId = `seed_tcat_${cat.id}`;
        await db
          .insert(templateCategories)
          .values({ id: categoryId, monthId, name: cat.name, position: ci + 1 });

        for (const [ti, task] of cat.tasks.entries()) {
          const taskId = `seed_tt_${task.id}`;
          await db.insert(templateTasks).values({
            id: taskId,
            categoryId,
            position: ti + 1,
            title: task.title,
            roleHint: task.role,
            priority: task.pri.toLowerCase() as 'low' | 'medium' | 'high' | 'urgent',
            estHours: task.est.toFixed(2),
            dueRule: dueRule(task),
            qcRequired: task.qcGate,
            proofRequired: task.proofReq,
            clientVisible: false,
            sopUrl: null,
            checklist: task.checklist,
            expectedOutput: null,
          });

          const subtasks = task.subtasks ?? [];
          if (subtasks.length > 0) {
            await db.insert(templateTaskSubtasks).values(
              subtasks.map((st, si) => ({
                id: `seed_tts_${st.id}`,
                taskId,
                title: st.title,
                position: si + 1,
              })),
            );
          }
        }
      }
    }
  }

  return {
    localSeo: 'seed_tpl_local_seo_monthly_campaign',
    websiteDesign: 'seed_tpl_website_design_project',
    technicalSeoAudit: 'seed_tpl_technical_seo_audit',
  };
}

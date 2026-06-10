import type { jsPDF } from "jspdf";
import {
  formatConfidenceTier,
  formatValidityClassification,
  type QcDisplayData,
} from "@/components/admin/qcValidityUi";
import { getTaskDisplayName } from "@/config/tasks";
import { buildValidityStatusTiles, collectExplainedFlags } from "@/lib/validityDashboardModel";
import {
  VALIDITY_IRB_DISCLAIMER,
  VALIDITY_PDF_INTRO,
  VALIDITY_STATUS_PDF_LABEL,
  friendlyValidityInterpretation,
  validityFlagTitle,
} from "@/lib/validityFlagExplanations";

export type ValidityPdfContext = {
  doc: jsPDF;
  margin: number;
  contentWidth: number;
  pageHeight: number;
  y: number;
  ensureSpace: (needed: number) => void;
};

type ValidityPdfPalette = {
  sectionTitle: readonly [number, number, number];
  body: readonly [number, number, number];
  muted: readonly [number, number, number];
  cardBg: readonly [number, number, number];
  cardBorder: readonly [number, number, number];
  noteBg: readonly [number, number, number];
  noteBorder: readonly [number, number, number];
  scoreGood: readonly [number, number, number];
  scoreMid: readonly [number, number, number];
  scoreLow: readonly [number, number, number];
};

const DEFAULT_PALETTE: ValidityPdfPalette = {
  sectionTitle: [31, 41, 55],
  body: [55, 65, 81],
  muted: [107, 114, 128],
  cardBg: [248, 250, 252],
  cardBorder: [226, 232, 240],
  noteBg: [239, 246, 255],
  noteBorder: [147, 197, 253],
  scoreGood: [22, 101, 52],
  scoreMid: [180, 83, 9],
  scoreLow: [185, 28, 28],
};

function scoreAccent(score: number | null | undefined, palette: ValidityPdfPalette): readonly [number, number, number] {
  if (score == null) return palette.muted;
  if (score >= 75) return palette.scoreGood;
  if (score >= 60) return palette.scoreMid;
  return palette.scoreLow;
}

function addSectionTitle(ctx: ValidityPdfContext, text: string, palette: ValidityPdfPalette) {
  ctx.ensureSpace(28);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(...palette.sectionTitle);
  ctx.doc.text(text, ctx.margin, ctx.y);
  ctx.y += 18;
}

function addWrappedText(
  ctx: ValidityPdfContext,
  text: string,
  opts: {
    size?: number;
    color?: readonly [number, number, number];
    indent?: number;
    lineGap?: number;
  } = {},
) {
  const size = opts.size ?? 10.5;
  const color = opts.color ?? DEFAULT_PALETTE.body;
  const indent = opts.indent ?? 0;
  const lineGap = opts.lineGap ?? 3;
  const width = ctx.contentWidth - indent;

  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(...color);
  const lines = ctx.doc.splitTextToSize(text, width);
  ctx.ensureSpace(lines.length * (size + lineGap) + 6);
  ctx.doc.text(lines, ctx.margin + indent, ctx.y);
  ctx.y += lines.length * (size + lineGap) + 6;
}

function drawRoundedCard(
  ctx: ValidityPdfContext,
  height: number,
  bg: readonly [number, number, number],
  border: readonly [number, number, number],
) {
  ctx.ensureSpace(height + 10);
  ctx.doc.setFillColor(...bg);
  ctx.doc.setDrawColor(...border);
  ctx.doc.roundedRect(ctx.margin, ctx.y, ctx.contentWidth, height, 8, 8, "FD");
}

/**
 * Renders a patient-friendly Data Quality & Validity block for jsPDF exports.
 * Returns the updated Y position.
 */
export function appendValiditySectionToPdf(
  ctx: ValidityPdfContext,
  qc: QcDisplayData | null | undefined,
  options?: {
    scopeLabel?: string;
    maxFlags?: number;
    palette?: Partial<ValidityPdfPalette>;
  },
): number {
  const palette = { ...DEFAULT_PALETTE, ...options?.palette };
  const maxFlags = options?.maxFlags ?? 50;

  addSectionTitle(ctx, "Data Quality & Validity", palette);
  addWrappedText(ctx, VALIDITY_PDF_INTRO, { size: 10.5, color: palette.body });

  if (qc) {
    const score = qc.overall_confidence_score ?? qc.validity_score;
    const classification = qc.validity_classification;
    const tier = qc.confidence_tier ?? qc.flags?.confidence_tier;
    const accent = scoreAccent(score, palette);

    const summary = friendlyValidityInterpretation(classification, score);
    const cardHeight = 92;
    const cardTop = ctx.y;
    drawRoundedCard(ctx, cardHeight, palette.cardBg, palette.cardBorder);

    const leftColX = ctx.margin + 14;
    const rightX = ctx.margin + ctx.contentWidth / 2 + 12;

    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(11);
    ctx.doc.setTextColor(...palette.sectionTitle);
    ctx.doc.text("Your confidence score", leftColX, cardTop + 22);

    const scoreText = score != null ? String(score) : "—";
    const scoreBaselineY = cardTop + 58;
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(26);
    ctx.doc.setTextColor(...accent);
    ctx.doc.text(scoreText, leftColX, scoreBaselineY);
    const scoreWidth = ctx.doc.getTextWidth(scoreText);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(11);
    ctx.doc.setTextColor(...palette.muted);
    ctx.doc.text("out of 100", leftColX + scoreWidth + 8, scoreBaselineY);

    ctx.y = cardTop;
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(10);
    ctx.doc.setTextColor(...palette.sectionTitle);
    ctx.doc.text("Classification", rightX, cardTop + 24);
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(13);
    ctx.doc.setTextColor(...accent);
    ctx.doc.text(formatValidityClassification(classification), rightX, cardTop + 44);

    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(...palette.muted);
    const tierText = formatConfidenceTier(tier);
    const tierLines = ctx.doc.splitTextToSize(tierText, ctx.contentWidth / 2 - 28);
    ctx.doc.text(tierLines, rightX, cardTop + 62);

    ctx.y = cardTop + cardHeight + 12;
    addWrappedText(ctx, summary, { size: 10.5, color: palette.body });

    const tiles = buildValidityStatusTiles(qc);
    if (tiles.length > 0) {
      ctx.ensureSpace(20);
      ctx.doc.setFont("helvetica", "bold");
      ctx.doc.setFontSize(10.5);
      ctx.doc.setTextColor(...palette.sectionTitle);
      ctx.doc.text("Quick quality checks", ctx.margin, ctx.y);
      ctx.y += 16;

      tiles.forEach((tile) => {
        const statusLabel = VALIDITY_STATUS_PDF_LABEL[tile.level] ?? tile.level;
        const row = `• ${tile.label}: ${statusLabel} — ${tile.summary}`;
        addWrappedText(ctx, row, { size: 9.5, color: palette.body, indent: 4, lineGap: 2 });
      });
      ctx.y += 4;
    }

    const flags = collectExplainedFlags(qc).slice(0, maxFlags);
    if (flags.length > 0) {
      ctx.doc.setFont("helvetica", "bold");
      ctx.doc.setFontSize(10.5);
      ctx.doc.setTextColor(...palette.sectionTitle);
      ctx.doc.text("What we noticed", ctx.margin, ctx.y);
      ctx.y += 14;

      flags.forEach((item) => {
        const title = item.taskName
          ? `${getTaskDisplayName(item.taskName)} · ${validityFlagTitle(item.id, item.taskName)}`
          : validityFlagTitle(item.id);
        addWrappedText(ctx, title, { size: 9.5, color: palette.sectionTitle, indent: 4, lineGap: 1 });
        addWrappedText(ctx, item.explanation, { size: 9, color: palette.muted, indent: 12, lineGap: 2 });
      });
    } else {
      addWrappedText(ctx, "No specific quality concerns were flagged for this assessment.", {
        size: 9.5,
        color: palette.muted,
      });
    }

    if (qc.assessment_interpretable === false) {
      addWrappedText(
        ctx,
        "Note: Because of data-quality concerns, these results should not be interpreted on their own without clinical review.",
        { size: 9.5, color: palette.scoreLow },
      );
    }
  }

  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(9);
  const irbLines = ctx.doc.splitTextToSize(VALIDITY_IRB_DISCLAIMER, ctx.contentWidth - 24);
  const irbBoxHeight = 34 + irbLines.length * 11;
  drawRoundedCard(ctx, irbBoxHeight, palette.noteBg, palette.noteBorder);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(29, 78, 216);
  ctx.doc.text("About data quality (important)", ctx.margin + 12, ctx.y + 18);

  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(9);
  ctx.doc.setTextColor(...palette.body);
  ctx.doc.text(irbLines, ctx.margin + 12, ctx.y + 34);
  ctx.y += irbBoxHeight + 14;

  return ctx.y;
}

/**
 * IrocLogo — logo mark + "iROC GmbH" + two-row brand tagline
 *
 * Matches the certificate header right-side iROC block exactly:
 *   Row 0:  iROC GmbH  (bold)
 *   Row 1:  {i}nnovative  &  {R}egenerative
 *   Row 2:  medical  {O}riented  {C}onsultation
 *
 * Both tagline rows are stretched to the same width via justify-between so the
 * first and last characters of each row are perfectly aligned.
 */

interface IrocLogoProps {
  /** URL / import of the logo mark image */
  src: string;
  /** Extra Tailwind classes for the <img> (e.g. "brightness-0 invert" for dark backgrounds) */
  imgClassName?: string;
  /** Extra Tailwind classes for the text block (default: text-[#002244]) */
  textClassName?: string;
  /** Height class for the mark image — default "h-10" */
  markHeight?: string;
  /** Width of the text column — default "w-[136px]" */
  taglineWidth?: string;
  /** Font-size class for the tagline rows — default "text-[8.5px]" */
  textSize?: string;
  /** Font-size class for "iROC GmbH" — default "text-[13px]" */
  gmbhSize?: string;
}

export function IrocLogo({
  src,
  imgClassName = '',
  textClassName = 'text-[#002244]',
  markHeight = 'h-10',
  taglineWidth = 'w-[136px]',
  textSize = 'text-[8.5px]',
  gmbhSize = 'text-[13px]',
}: IrocLogoProps) {
  return (
    <div className="flex items-center gap-1.5 select-none">
      {/* Mark */}
      <img
        src={src}
        alt="iROC"
        className={`${markHeight} w-auto object-contain ${imgClassName}`}
      />

      {/* Text column: iROC GmbH + two justified tagline rows */}
      <div className={`${taglineWidth} flex flex-col ${textClassName}`}>
        {/* iROC GmbH */}
        <span className={`${gmbhSize} font-black leading-none tracking-wide`}>
          iROC GmbH
        </span>

        {/* Taglines */}
        <div className={`${textSize} font-medium leading-none tracking-wide mt-[3px]`}>
          {/* Row 1: innovative & Regenerative */}
          <div className="flex justify-between items-baseline w-full">
            <span>
              <strong className="font-black">i</strong>nnovative
            </span>
            <span>&amp;</span>
            <span>
              <strong className="font-black">R</strong>egenerative
            </span>
          </div>

          {/* Row 2: medical Oriented Consultation */}
          <div className="flex justify-between items-baseline w-full mt-[1.5px]">
            <span>medical</span>
            <span>
              <strong className="font-black">O</strong>riented
            </span>
            <span>
              <strong className="font-black">C</strong>onsultation
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

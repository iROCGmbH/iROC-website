/**
 * IrocLogo — logo mark + "iROC GmbH" + two-row brand tagline
 *
 * Matches the certificate header right-side iROC block exactly:
 *   Row 0:  iROC GmbH  (bold)
 *   Row 1:  {i}nnovative  &  {R}egenerative
 *   Row 2:  medical  {O}riented  {C}onsultation
 */

interface IrocLogoProps {
  src: string;
  imgClassName?: string;
  textClassName?: string;
  markHeight?: string;
  taglineWidth?: string;
  textSize?: string;
  /** Font-size class for "iROC GmbH" — defaults to ~2.57× textSize */
  gmbhSize?: string;
}

export function IrocLogo({
  src,
  imgClassName = '',
  textClassName = 'text-[#002244]',
  markHeight = 'h-8',
  taglineWidth = 'w-[120px]',
  textSize = 'text-[7.5px]',
  gmbhSize = 'text-[11px]',
}: IrocLogoProps) {
  return (
    <div className="flex items-center gap-1 select-none">
      <img
        src={src}
        alt="iROC"
        className={`${markHeight} w-auto object-contain ${imgClassName}`}
      />
      <div className={`${taglineWidth} flex flex-col ${textClassName}`}>
        {/* iROC GmbH */}
        <span className={`${gmbhSize} font-black leading-none tracking-wide`}>
          iROC GmbH
        </span>
        {/* Taglines */}
        <div className={`${textSize} font-medium leading-none tracking-wide mt-[3px]`}>
          <div className="flex justify-between items-baseline w-full">
            <span><strong className="font-black">i</strong>nnovative</span>
            <span>&amp;</span>
            <span><strong className="font-black">R</strong>egenerative</span>
          </div>
          <div className="flex justify-between items-baseline w-full mt-[1.5px]">
            <span>medical</span>
            <span><strong className="font-black">O</strong>riented</span>
            <span><strong className="font-black">C</strong>onsultation</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import Image from "next/image";

import Reveal from "@/components/ui/Reveal";

import styles from "./ImageBand.module.css";

type ImageBandProps = {
  src: string;
  alt: string;
  caption: string;
  priority?: boolean;
};

/**
 * Full-width editorial photo band: a cropped framed image with a small-caps
 * caption. Used between homepage sections to let the school's imagery carry
 * the page instead of long copy.
 */
export default function ImageBand({ src, alt, caption, priority }: ImageBandProps) {
  return (
    <Reveal className={styles.band}>
      <figure className={styles.figure}>
        <div className={styles.frame}>
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 700px) 100vw, 92vw"
            quality={80}
            priority={priority}
            className={styles.img}
          />
        </div>
        <figcaption className={styles.caption}>{caption}</figcaption>
      </figure>
    </Reveal>
  );
}

import Image from "next/image";
import Link from "next/link";

import PublicHeader from "@/components/layouts/PublicHeader";
import Button from "@/components/ui/Button";
import { ChinarMark } from "@/components/ui/ChinarMark";
import GirihPattern from "@/components/ui/GirihPattern";
import TrustRibbon from "./TrustRibbon";
import styles from "./Hero.module.css";

/**
 * Full-bleed ink hero for the homepage: a single clean header row
 * (brand, nav, portal action), then the 55/45 composition — headline,
 * deck, CTA and trust line left; the framed arch photograph right. The
 * canvas (girih pattern, ghost wordmark, chinar watermark) stays behind
 * as faint texture.
 */
export default function Hero() {
  return (
    <section className={styles.hero} aria-label="Welcome to Faiz Aam Secondary School">
      <div className={styles.canvas} aria-hidden="true">
        <GirihPattern tone="chalk" opacity={0.045} className={styles.pattern} />
        <div className={styles.grid} />
        <div className={styles.watermark}>
          <ChinarMark size={140} tone="chalk" />
        </div>
        <div className={styles.ghost}>
          FAIZ
          <br />
          AAM
        </div>
      </div>

      <div className={styles.headerRow}>
        <PublicHeader tone="dark" />
      </div>

      <div className={styles.body}>
        <div className={styles.content}>
          <p className="eyebrow">
            Bandipora · Jammu &amp; Kashmir{" "}
            <ChinarMark size={14} tone="saffron" />
          </p>
          <h1 className={styles.title}>
            Rooted here.
            <br />
            Ready for the world.
          </h1>
          <p className={styles.deck}>
            Disciplined learning. Good character. Possibility for every child.
          </p>
          <div className={styles.actions}>
            <Button href="/admissions/apply" variant="saffron" className={styles.cta}>
              Begin an application →
            </Button>
            <Link className={`link-arrow ${styles.quietLink}`} href="/about">
              Discover the school
              <span className={styles.quietArrow} aria-hidden="true">
                →
              </span>
            </Link>
          </div>

          <TrustRibbon />
        </div>

        <figure className={styles.photoPanel}>
          <div className={styles.photoFrame}>
            <Image
              src="/images/faiz-e-aam-generated-hero.png"
              alt="Students on the school grounds at first light — concept illustration"
              fill
              sizes="(max-width: 1000px) 100vw, 46vw"
              quality={80}
              priority
              className={styles.photo}
            />
          </div>
          <figcaption className={styles.caption}>
            The school at first light — concept illustration
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

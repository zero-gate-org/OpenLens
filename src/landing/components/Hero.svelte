<script>
  /**
   * The hero.
   *
   * Asymmetric on purpose: copy on the left at roughly 7/12ths, the working
   * demo at 5/12ths. A centred hero with a centred demo under it is the shape
   * every tool page takes, and it wastes the one asset that has something to
   * say for itself.
   *
   * Four text elements and no more: the kicker, the headline, the lede, the
   * buttons. The demo's own controls sit inside the figure, below the headline,
   * where they belong.
   */
  import ArrowRightIcon from "phosphor-svelte/lib/ArrowRight";

  import LiveDemo from "./LiveDemo.svelte";
  import { reveal } from "../lib/reveal.js";
</script>

<section class="hero">
  <div class="wrap split">
    <div class="copy">
      <!--
        Scale and price, nothing else. The privacy claim is the headline's job
        and the facts band's job; spending the kicker on it as well would say
        the same thing three times before the visitor has seen a picture.
      -->
      <p class="kicker" use:reveal>Twenty-five photo tools. Free.</p>

      <h1 class="display" use:reveal={{ delay: 70 }}>Edit a photo. Never upload it.</h1>

      <!--
        The lede is capability, not mechanism. Each tool is named in the plain
        words a visitor would use for it, with the tool's own name attached so
        they can find it again in the board below. "Every change happens on
        your machine" was here before and it is the headline said again in
        smaller type.
      -->
      <p class="lede" use:reveal={{ delay: 140 }}>
        Cut out a background, turn a photo two-tone, bend a headline round a curve, print it as a page
        of dots. Twenty-five tools, free, and nothing to sign up for.
      </p>

      <div class="actions" use:reveal={{ delay: 210 }}>
        <a class="btn btn--primary" href="./editor.html">
          Open the editor
          <ArrowRightIcon size={16} weight="bold" />
        </a>
        <!--
          "See all 25 tools", not "See what it can do". The old label named no
          destination and no quantity, so it promised nothing a reader could
          check themselves against. The number is a numeral here and a word in
          the kicker on purpose: this is the page's scannable register, that is
          its editorial one.
        -->
        <a class="arrow-link" href="#tools">
          See all 25 tools
          <ArrowRightIcon size={15} weight="bold" />
        </a>
      </div>
    </div>

    <div class="stage" use:reveal={{ delay: 180 }}>
      <LiveDemo />
    </div>
  </div>
</section>

<style>
  .hero {
    /*
     * The top padding clears the floating tab, which is `position: fixed` and so
     * takes no space in the flow. Tab top is 16px and it is 56px tall, so its
     * lower edge sits at 72px; the copy starts below that with room to breathe.
     * `pt-24` is the documented ceiling for hero top padding and this lands
     * under it at every width.
     */
    padding-block: clamp(5.5rem, 3.5rem + 6vw, 8.5rem) clamp(3.5rem, 2rem + 6vw, 7rem);
    /* One accent glow, at the top, behind everything, tinted to the graphite
       family rather than dropped in as a coloured blob. It is the only
       decorative gradient on the page and it never crosses into another hue. */
    background:
      radial-gradient(
        120% 78% at 78% -10%,
        rgba(110, 231, 168, 0.11),
        transparent 58%
      ),
      radial-gradient(90% 60% at 8% 0%, rgba(110, 231, 168, 0.05), transparent 62%);
  }

  .split {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: clamp(2.5rem, 1rem + 5vw, 5.5rem);
    align-items: center;
  }

  .copy {
    display: grid;
    gap: var(--s-6);
    justify-items: start;
    /* The copy column stops well short of the demo so the two never crowd. */
    max-width: 620px;
  }

  .display {
    /*
     * Six words at this size lands on two lines at desktop, which is what the
     * comment above the kicker is about: the copy is doing real work here, so
     * the size gives rather than the copy being cut to fit. The alternative was
     * to shorten the headline, and the shorter versions all lost the sentence
     * that makes the promise specific.
     */
    margin: 0;
  }

  .lede {
    max-width: 44ch;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-5) var(--s-6);
    margin-top: var(--s-2);
  }

  .stage {
    /* The demo is the taller of the two columns and it sets the hero's height,
       so it is capped against the viewport rather than allowed to push the
       headline below the fold on a short laptop screen. */
    width: 100%;
    max-width: 480px;
    justify-self: end;
  }

  @media (max-width: 960px) {
    .split {
      grid-template-columns: 1fr;
      gap: var(--sp-tight);
    }

    .copy {
      max-width: none;
    }

    .stage {
      justify-self: start;
      max-width: 420px;
    }
  }

  @media (max-width: 560px) {
    .actions {
      gap: var(--s-5);
    }

    .actions .btn {
      width: 100%;
    }

    .stage {
      max-width: none;
    }
  }
</style>

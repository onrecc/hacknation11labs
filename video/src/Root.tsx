import { Composition, staticFile } from "remotion";
import { Product, productDuration } from "./Product";
import { Demo, demoDuration, type DemoProps } from "./Demo";
import { Tech, techDuration } from "./Tech";
import { Team, teamDefault, teamDuration, type TeamProps } from "./Team";
export const Root = () => (
  <>
    <Composition id="Demo" component={Demo} fps={30} width={1920} height={1080} durationInFrames={demoDuration({})} defaultProps={{} as DemoProps}
      calculateMetadata={({ props }) => ({ durationInFrames: demoDuration(props) })} />
    <Composition id="Tech" component={Tech} fps={30} width={1920} height={1080} durationInFrames={techDuration()} />
    <Composition id="Team" component={Team} fps={30} width={1920} height={1080} durationInFrames={teamDuration(teamDefault)} defaultProps={teamDefault as TeamProps}
      calculateMetadata={({ props }) => ({ durationInFrames: teamDuration(props) })} />
    <Composition id="Product" component={Product} fps={30} width={1920} height={1080} durationInFrames={productDuration()} />
  </>
);
export { staticFile };

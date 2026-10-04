import { Composition, staticFile } from "remotion";
import { Product, productDuration } from "./Product";
export const Root = () => (
  <Composition id="Product" component={Product} fps={30} width={1920} height={1080} durationInFrames={productDuration()} />
);
export { staticFile };

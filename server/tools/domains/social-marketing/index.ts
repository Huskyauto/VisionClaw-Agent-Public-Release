/**
 * Tools-layer-split S25q — social-marketing domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 4 marketing tools (draft_social_post,
 * manage_content_calendar, marketing_analytics, marketing_experiment) migrate
 * their definitions AND handlers. Backed by server/social-marketing.
 */
import { registerTools } from "../../registry";
import { socialMarketingDomainTools } from "./handlers";

registerTools(socialMarketingDomainTools);

export {
  draftSocialPostDefinition,
  manageContentCalendarDefinition,
  marketingAnalyticsDefinition,
  marketingExperimentDefinition,
  socialMarketingDomainDefinitions,
} from "./definitions";

export { socialMarketingDomainTools } from "./handlers";

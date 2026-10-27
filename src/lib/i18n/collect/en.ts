import { RECORDER_LABELS } from "@/components/collect/recorder-labels";

/**
 * Everything the step-by-step form says, in English: the reference set.
 * Every other locale file must have exactly these keys (`satisfies
 * Record<LabelKey, string>`), and an owner can override any of them per form.
 * `{project}`, `{n}` and the like are filled in when shown.
 */
export const en = {
  // Moving between steps
  back: "Back",
  next: "Continue",
  submit: "Send",
  sending: "Sending…",
  finishingUpload: "Finishing upload…",
  stepOf: "Step {n} of {total}",
  optional: "(optional)",
  skip: "Skip this question",
  choose: "Choose…",
  // Errors
  errorRequired: "Please answer this question.",
  errorField: "Please fill in this field.",
  errorName: "Please enter your name",
  errorEmail: "Please enter a valid email",
  errorUrl: "Please enter a full web address, starting with https://",
  errorNumber: "Please enter a number.",
  errorConsent: "Please tick the consent box so we can share your testimonial",
  errorRating: "Please choose a rating.",
  errorVideo: "Record or upload a video before you continue.",
  errorUploading: "Your video is still uploading. Wait a moment, then try again.",
  errorSend: "Your testimonial didn't send. Check your connection and try again.",
  // Closed form
  closedTitle: "This form is closed",
  closedMessage: "It isn't taking new testimonials right now. Thank you for thinking of us.",
  // Rating
  ratingTitle: "How was your experience?",
  ratingLabel: "Rating",
  ratingWord1: "Poor",
  ratingWord2: "Fair",
  ratingWord3: "Good",
  ratingWord4: "Great",
  ratingWord5: "Outstanding",
  starOne: "1 star",
  starMany: "{n} stars",
  // Welcome
  welcomeTitle: "Share your experience with {project}",
  welcomeMessage: "It takes about two minutes. Record a short video or write a few lines, whichever suits you.",
  start: "Start",
  // Questions
  answerWrite: "Write",
  answerVideo: "Video",
  answerType: "How you'd like to answer",
  textPlaceholder: "Tell it like you'd tell a friend. What made the difference?",
  yourAnswer: "Your answer",
  tipsLabel: "Ideas for what to say",
  addImages: "Add images",
  imagesHint: "Up to {n} images, PNG, JPEG, WebP or GIF",
  removeImage: "Remove image",
  landscapeHint: "Tip: turn your phone sideways for a better video.",
  // Private feedback
  feedbackPlaceholder: "Write as much or as little as you like.",
  feedbackPrivate: "Private: only {project} sees this. It's never published.",
  // Consent
  consentTitle: "Can {project} share it?",
  consentDefault: "I agree that {project} may publish this testimonial, with my name, photo and video, on its website and marketing.",
  consentPublic: "Yes, {project} may share it",
  consentPrivate: "Keep it private: for {project}'s internal use only",
  consentExtras: "You may also use it for:",
  scopeSocial: "Social media posts",
  scopeAds: "Paid advertising",
  scopeName: "Showing my full name",
  scopeFace: "Showing my face",
  // About you
  aboutYouTitle: "About you",
  name: "Your name",
  email: "Email",
  emailHint: "(private, never shown publicly)",
  jobTitle: "Role / title",
  company: "Company",
  website: "Website",
  phone: "Phone",
  phoneHint: "(private)",
  photo: "Photo",
  photoHint: "A headshot or your logo, under {mb} MB",
  photoChange: "Looks good. Click to change it.",
  photoUnsupported: "This photo isn't a format we can use. Choose a PNG, JPEG, WebP or GIF image.",
  fileTooLarge: "The file is larger than {mb} MB",
  socials: "Social profiles",
  socialX: "X (Twitter)",
  socialLinkedin: "LinkedIn",
  socialInstagram: "Instagram",
  socialTiktok: "TikTok",
  npsLow: "Not likely",
  npsHigh: "Very likely",
  // About your company
  aboutCompanyTitle: "About your company",
  companyWebsite: "Company website",
  companyLogo: "Company logo",
  logoHint: "PNG, JPEG, WebP or GIF, under {mb} MB",
  // Review
  reviewTitle: "Check and send",
  reviewEdit: "Edit",
  reviewSkipped: "Skipped",
  reviewVideo: "Video recorded",
  reviewPublic: "You agreed that {project} may share it.",
  reviewPrivate: "You asked to keep it private.",
  // Thank you
  thankYouTitle: "Thank you!",
  thankYouMessage: "{project} will review it shortly. You can close this page.",
  copyHint: "Want to post it somewhere too? Copy what you wrote.",
  copyWords: "Copy my words",
  copied: "Copied",
  shareTitle: "Share it",
  shareOn: "Share on {network}",
  withdrawNote:
    "Changed your mind later? This private link lets you withdraw your testimonial at any time. Keep it somewhere safe; anyone with it can withdraw.",
  copyLink: "Copy link",
  // A saved draft (FORM-14)
  draftFound: "You started this testimonial earlier on this device.",
  draftResume: "Continue where you left off",
  draftStartOver: "Start over",
  draftVideoAgain: "Videos aren't kept in a draft, so you'll record yours again.",
  // The recorder
  ...RECORDER_LABELS,
};

export type LabelKey = keyof typeof en;

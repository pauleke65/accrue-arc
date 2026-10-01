import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, UserRejectedRequestError } from "viem";

/** What each contract error means to the person who hit it. */
const MESSAGES: Record<string, string> = {
  InvalidJob: "That job doesn't exist.",
  WrongStatus: "The job has moved on since this page loaded. Refresh to see where it stands.",
  Unauthorized: "Your account can't do that on this job.",
  ZeroAddress: "An address is missing.",
  ExpiryTooShort: "The job needs to stay open longer.",
  DescriptionTooLong: "The brief is too long to store on chain.",
  ZeroBudget: "Set a budget before funding.",
  ProviderNotSet: "Choose who will do the work before funding.",
  BudgetMismatch: "The price changed before your transaction landed. Check it and try again.",
  JobExpiredAlready: "The job has expired.",
  EmptyDeliverable: "Add your evidence before submitting.",
  HookNotSupported: "That job uses a hook this app doesn't recognise.",
  TransferFailed: "The USDC transfer failed. Check your balance, and that neither account is blocklisted.",
  UnsupportedToken: "The token didn't move the exact amount.",
  Reentrancy: "The contract refused a nested call.",
  NotGoverned: "This job isn't governed by an Accrue panel.",
  PanelRequired: "Name the job's reviewers first.",
  InvalidPanel: "The panel isn't valid: check the reviewers, the quorum and the deadlines.",
  ProviderOnPanel: "The worker can't review their own job.",
  DeliveryClosed: "The delivery deadline has passed.",
  DeliveryOpen: "The worker still has time to deliver.",
  BadEvidence: "The evidence doesn't match what was submitted.",
  NotReviewer: "Only the job's reviewers can vote.",
  AlreadyVoted: "You've already voted on this delivery.",
  ReviewClosed: "The review window has closed. Silence now pays the worker.",
  ReviewOpen: "The review window is still open.",
  BadReport: "Add a short note with your vote.",
  NotParty: "Only the client or the worker can do that.",
  AlreadyConsented: "You've already agreed to cancel. Waiting for the other side.",
  CannotApply: "You can't apply to this job.",
};

export function readableError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled the request.";
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = reverted?.data?.errorName;
    if (name && MESSAGES[name]) return MESSAGES[name];
    if (error.walk((e) => e instanceof ContractFunctionZeroDataError))
      return "Accrue's contracts aren't deployed on this network yet. Check the Status page.";
    if (/insufficient funds|exceeds the balance/i.test(error.message)) return "Not enough USDC on Arc for this and its network fee.";
    return error.shortMessage || error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

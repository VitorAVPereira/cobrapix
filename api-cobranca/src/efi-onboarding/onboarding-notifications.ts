export abstract class OnboardingNotifications {
  abstract sendNotice(
    companyId: string,
    phone: string,
    representative: string,
    companyName: string,
  ): Promise<string>;
  abstract sendReminder(
    companyId: string,
    phone: string,
    companyName: string,
  ): Promise<string>;
  abstract alert(companyId: string, code: string): Promise<void>;
}

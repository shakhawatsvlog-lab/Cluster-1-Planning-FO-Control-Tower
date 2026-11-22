export interface WebsiteControlConfig {
  companyName: string;
  portalTitle: string;
  readOnlyPublicMode: boolean;
  inputStartOffsetDays: number;
  upcomingFoOffsetDays: number;
  cuttingAlertDays: number;
  recoveryEmail: string;
}

export const DEFAULT_WEBSITE_CONTROL_CONFIG: WebsiteControlConfig = {
  companyName: 'Alex Apparels',
  portalTitle: 'Cluster 1 Planning & FO Control Tower',
  readOnlyPublicMode: false,
  inputStartOffsetDays: 10,
  upcomingFoOffsetDays: 15,
  cuttingAlertDays: 10,
  recoveryEmail: '',
};

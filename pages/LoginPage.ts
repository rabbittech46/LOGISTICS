import { expect, type Page } from '@playwright/test';
import { appConfig, type RegistrationUser } from '../fixtures/testData';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`${appConfig.baseUrl}/login`);
    await expect(this.page.getByTestId('login-form')).toBeVisible();
  }

  async gotoRegister(): Promise<void> {
    await this.page.goto(`${appConfig.baseUrl}/register`);
    await expect(this.page.getByTestId('register-form')).toBeVisible();
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByTestId('login-submit').click();
  }

  async register(user: RegistrationUser): Promise<void> {
    await this.page.getByLabel('First name').fill(user.firstName);
    await this.page.getByLabel('Last name').fill(user.lastName);
    await this.page.getByLabel('Email').fill(user.email);
    await this.page.getByLabel('Phone (optional)').fill(user.phone);
    await this.page.getByLabel('Password').fill(user.password);
    await this.page.getByTestId('register-submit').click();
  }

  errorBanner() {
    return this.page.getByRole('alert').first();
  }
}
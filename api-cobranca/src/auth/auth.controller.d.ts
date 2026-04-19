import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(loginDto: LoginDto, res: Response): Promise<{
        user: {
            id: any;
            email: any;
            name: any;
            companyId: any;
        };
        access_token: string;
    }>;
    logout(res: Response): Promise<{
        message: string;
    }>;
    getSession(user: any): Promise<{
        user: {
            id: any;
            email: any;
            name: any;
            companyId: any;
        };
    }>;
}

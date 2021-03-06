import { Injectable } from '@angular/core';
import { Router, CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import {AwsService} from '../../services/aws-service';

@Injectable()
export class AuthGuard implements CanActivate {

    constructor(
        private router: Router,
        private awsService: AwsService
    ) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        if (this.awsService.tmpAccessKeyId && this.awsService.tmpExpireTime > new Date()) {
            return true;
        }

        this.router.navigate(['/login'], {
            queryParams: { returnUrl: state.url },
            skipLocationChange: true,
        });
        return false;
    }
}

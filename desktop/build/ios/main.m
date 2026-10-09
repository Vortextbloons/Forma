

#import <UIKit/UIKit.h>
#include <stdio.h>

int main(int argc, char * argv[]) {
    @autoreleasepool {

        setvbuf(stdout, NULL, _IONBF, 0);
        setvbuf(stderr, NULL, _IONBF, 0);









        return UIApplicationMain(argc, argv, nil, @"WailsAppDelegate");
    }
}

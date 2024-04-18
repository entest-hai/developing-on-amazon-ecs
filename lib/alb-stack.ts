import {
  aws_ec2,
  aws_elasticloadbalancingv2,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { Construct } from "constructs";

interface AlbProps extends StackProps {
  vpc: aws_ec2.Vpc;
}

export class AlbStack extends Stack {
  public readonly alb: aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  public readonly blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly prodListener: aws_elasticloadbalancingv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: AlbProps) {
    super(scope, id, props);

    // application load balancer
    const alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "AlbForEcs",
      {
        vpc: props.vpc,
        internetFacing: true,
      }
    );

    // add product listener
    const prodListener = alb.addListener("ProdListener", {
      port: 80,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    // add test listener
    const testListener = alb.addListener("TestListener", {
      port: 8080,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    prodListener.connections.allowDefaultPortFromAnyIpv4("");
    testListener.connections.allowDefaultPortFromAnyIpv4("");

    // blue target group
    const blueTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GlueTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          port: 80,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          vpc: props.vpc,
        }
      );

    // green target group
    const greenTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GreenTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          port: 80,
          vpc: props.vpc,
        }
      );

    prodListener.addTargetGroups("GlueTargetGroup", {
      targetGroups: [blueTargetGroup],
    });

    testListener.addTargetGroups("GreenTargetGroup", {
      targetGroups: [greenTargetGroup],
    });

    // export output
    this.alb = alb;
    this.blueTargetGroup = blueTargetGroup;
    this.greenTargetGroup = greenTargetGroup;
    this.prodListener = prodListener;
  }
}

import * as Cesium from 'cesium';
const u = { u_headDetail: new Cesium.Cartesian4(), u_age: 0, u_x: 1 };
const stage = new Cesium.PostProcessStage({ fragmentShader: 'void main(){out_FragColor=vec4(1.0);}', uniforms: u });
console.log('same ref?', stage.uniforms.u_headDetail === u.u_headDetail);
u.u_headDetail.x = 0.45; u.u_headDetail.y = 1.3; u.u_headDetail.z = 0.8;
console.log('after write', JSON.stringify({ x: stage.uniforms.u_headDetail.x, y: stage.uniforms.u_headDetail.y, z: stage.uniforms.u_headDetail.z }));
console.log('typeof descriptor', Object.getOwnPropertyDescriptor(stage.uniforms, 'u_headDetail'));
u.u_age = 513.8;
console.log('age via stage', stage.uniforms.u_age);

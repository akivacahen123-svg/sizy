import torch,torch.nn as nn,torch.nn.functional as F
class SRVGGNetCompact(nn.Module):
    def __init__(s,nin=3,nout=3,nf=64,nc=32,up=4):
        super().__init__();s.up=up;s.body=nn.ModuleList()
        s.body.append(nn.Conv2d(nin,nf,3,1,1));s.body.append(nn.PReLU(num_parameters=nf))
        for _ in range(nc):
            s.body.append(nn.Conv2d(nf,nf,3,1,1));s.body.append(nn.PReLU(num_parameters=nf))
        s.body.append(nn.Conv2d(nf,nout*up*up,3,1,1));s.upsampler=nn.PixelShuffle(up)
    def forward(s,x):
        o=x
        for l in s.body:o=l(o)
        o=s.upsampler(o)
        return o+F.interpolate(x,scale_factor=s.up,mode='nearest')
m=SRVGGNetCompact();sd=torch.load('dl/realesr-general-x4v3.pth',map_location='cpu',weights_only=True)
sd=sd.get('params',sd);print(m.load_state_dict(sd));m.eval()
x=torch.rand(1,3,64,64)
torch.onnx.export(m,x,'realesr-general-x4v3.onnx',input_names=['input'],output_names=['output'],dynamic_axes={'input':{2:'h',3:'w'},'output':{2:'H',3:'W'}},opset_version=17,dynamo=False)
import os;print(os.path.getsize('realesr-general-x4v3.onnx'))
